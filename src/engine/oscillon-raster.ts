import {
  hexToReflect,
  percentileBands,
  toneGains,
  writeMaster,
  writeProof,
  writeRGB,
  type Exposure,
} from "./oscillon-engine.ts";

/*
  Pure raster composing — no DOM, no canvas. Produces RGBA buffers from
  developed exposures so the CLI (and anything else headless) can render
  exactly what the app composites:

  - phosphor: tone-mapped core + bilinearly upscaled glow, added
    saturating over black — the additive scope view.
  - paper: separation bands multiplied over the paper color with the
    same per-drum misregistration as the app (writeProof).
  - masters: per-drum dark-on-white greys sharing one auto-exposure.

  Letterboxing composes the square exposure into an arbitrary W×H
  canvas, matching the app's centered layout.
*/

export type RGBA = Uint8ClampedArray;

export function bilinearScaleRGBA(
  src: RGBA,
  sw: number,
  sh: number,
  dw: number,
  dh: number
): RGBA {
  if (sw === dw && sh === dh) return src;
  const out = new Uint8ClampedArray(dw * dh * 4);
  const xr = sw / dw;
  const yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1.001, y * yr);
    const y0 = sy | 0;
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1.001, x * xr);
      const x0 = sx | 0;
      const fx = sx - x0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const j = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
        const bottom = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
        out[j + c] = top + (bottom - top) * fy;
      }
    }
  }
  return out;
}

/** the additive phosphor composite as a square RGBA at exposure size */
export function phosphorSquare(exp: Exposure): RGBA {
  const S = exp.S;
  const G = exp.G;
  const gains = toneGains(exp);
  const core = new Uint8ClampedArray(S * S * 4);
  writeRGB(core, exp.core, S, gains.core);
  const glowSmall = new Uint8ClampedArray(G * G * 4);
  writeRGB(glowSmall, exp.glow, G, gains.glow);
  const glow = bilinearScaleRGBA(glowSmall, G, G, S, S);
  for (let i = 0; i < core.length; i += 4) {
    core[i] += glow[i];
    core[i + 1] += glow[i + 1];
    core[i + 2] += glow[i + 2];
    core[i + 3] = 255;
  }
  return core;
}

/** the paper-proof composite as a square RGBA at exposure size */
export function paperSquare(exp: Exposure, paperHex: string = "#faf8f3"): RGBA {
  const out = new Uint8ClampedArray(exp.S * exp.S * 4);
  writeProof(out, exp, exp.S, hexToReflect(paperHex));
  return out;
}

/** one drum's master as a square RGBA (dark ink on white) */
export function masterSquare(
  exp: Exposure,
  bandIndex: number,
  sharedGain?: number
): RGBA {
  const K = sharedGain ?? percentileBands(exp.bands, exp.S, 2.8);
  const out = new Uint8ClampedArray(exp.S * exp.S * 4);
  writeMaster(out, exp.bands[bandIndex], exp.S, K);
  return out;
}

/** compose a square RGBA into a letterboxed W×H canvas */
export function letterbox(
  square: RGBA,
  squareSize: number,
  width: number,
  height: number,
  background: [number, number, number] | null
): RGBA {
  const out = new Uint8ClampedArray(width * height * 4);
  if (background) {
    const r = Math.round(background[0] * 255);
    const g = Math.round(background[1] * 255);
    const b = Math.round(background[2] * 255);
    for (let i = 0; i < out.length; i += 4) {
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  const side = Math.min(width, height);
  const scaled =
    side === squareSize
      ? square
      : bilinearScaleRGBA(square, squareSize, squareSize, side, side);
  const ox = (width - side) >> 1;
  const oy = (height - side) >> 1;
  for (let y = 0; y < side; y++) {
    const srcRow = y * side * 4;
    const dstRow = ((y + oy) * width + ox) * 4;
    out.set(scaled.subarray(srcRow, srcRow + side * 4), dstRow);
  }
  return out;
}
