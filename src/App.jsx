import { useCallback, useEffect, useRef, useState } from "react";
import "./App.scss";

/*
  OSCILLON — after Ben Laposky (1914–2000)

  A simulated oscilloscope beam. Two modulated sine signals drive the
  X and Y deflection; the beam deposits light into an accumulation
  buffer, sampled uniformly in time so the trace brightens wherever
  the beam slows (cusps, folds) — exactly as on a phosphor screen
  photographed with a long exposure. Color is a filter wheel:
  hue is a function of time through the exposure.

  Each exposure is seeded, and the seed lives in the URL hash — so a
  piece you like is shareable and can be re-rendered later at print
  resolution. "Print masters" re-develops the current seed at 2400px
  and exports the composite plus greyscale separations (dark ink on
  white), one per riso drum.

  Risograph inks: pick up to four inks from the Risolve color wheel
  (in drum order) and the filter wheel walks them across the
  exposure. Selecting inks recolors the current figure — the seed
  doesn't change — and print masters become one separation per ink.
  The ink set travels in the URL after the seed: #seed/25,11

  click / N / space — new exposure
  S — save png · E — print masters · I — inks
*/

const TAU = Math.PI * 2;

const VIEW_SIZE = 1200; // on-screen exposure resolution (px)
const VIEW_SAMPLES = 1.7e6; // beam samples per exposure
const CHUNK = 10000; // samples per animation frame
const PRINT_SCALE = 2; // print masters develop at 2400px, 4x samples
const CLASSIC_LAYERS = 3; // time bands -> drums for the built-in palettes
const MAX_INKS = 4;

// tone-map LUT: film response  v = 1 - e^(-x)
const LUT_N = 4096;
const LUT_MAX = 9;
const LUT8 = new Uint8Array(LUT_N);
for (let i = 0; i < LUT_N; i++) {
  LUT8[i] = Math.round(255 * (1 - Math.exp((-i * LUT_MAX) / LUT_N)));
}

// cheap gaussian-ish jitter (sd ~0.52) — film grain, deliberately unseeded
const g3 = () => Math.random() + Math.random() + Math.random() - 1.5;

// deterministic rng, so one 32-bit seed always reproduces its exposure
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randomSeed = () => (Math.random() * 0x100000000) >>> 0;
const seedHex = (seed) => (seed >>> 0).toString(16).padStart(8, "0");

// ------------------------------------------------------------- riso inks

// The Risolve color wheel (risolvestudio.com/products/color-wheel),
// hexcodes via ~/code/onyx/scripts/risograph.ts
const RISO_INKS = [
  { name: "White", hex: "#ffffff" },
  { name: "Scarlet", hex: "#f04f55" },
  { name: "Orange", hex: "#f36d38" },
  { name: "Sunflower", hex: "#fcb132" },
  { name: "Yellow", hex: "#ffda23" },
  { name: "Light Lime", hex: "#d9e256" },
  { name: "Kelly Green", hex: "#3ca448" },
  { name: "Agave", hex: "#65aa93" },
  { name: "Turquoise", hex: "#009977" },
  { name: "Hunter Green", hex: "#436056" },
  { name: "Mint", hex: "#80cfd0" },
  { name: "Light Teal", hex: "#008999" },
  { name: "Aqua", hex: "#22bde8" },
  { name: "Cornflower", hex: "#5a96d0" },
  { name: "Blue", hex: "#007dc2" },
  { name: "Federal Blue", hex: "#44608c" },
  { name: "Steel", hex: "#41586b" },
  { name: "Violet", hex: "#8d79b8" },
  { name: "Purple", hex: "#614a86" },
  { name: "Burgundy", hex: "#844f55" },
  { name: "Brown", hex: "#795645" },
  { name: "Flat Gold", hex: "#98763c" },
  { name: "Light Gray", hex: "#9e9c9d" },
  { name: "Black", hex: "#21201f" },
  { name: "Peach", hex: "#fdd6c0" },
  { name: "Fluor Pink", hex: "#f07db1" },
  { name: "Neon Coral", hex: "#f1729d" },
  { name: "Fluor Orange", hex: "#fd8288" },
  { name: "Fluor Yellow", hex: "#e6e983" },
  { name: "Fluor Green", hex: "#93ce9b" },
  { name: "Metallic Gold", hex: "#a29280" },
  { name: "Bisque", hex: "#f1bfa4" },
  { name: "Bubblegum", hex: "#f280a4" },
  { name: "Cranberry", hex: "#c04b60" },
];

// ink hexes are reflective (paper); lift them toward emission for the
// screen, but let genuinely dark inks stay dim
function hexToFilter(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const k = Math.min(1 / Math.max(c[0], c[1], c[2], 1e-6), 2.5);
  return [c[0] * k, c[1] * k, c[2] * k];
}
for (const ink of RISO_INKS) ink.rgb = hexToFilter(ink.hex);

// printed-and-proven pairs, May 2024 Risolve stock, via ~/code/onyx
const RISO_COMBOS = [
  ["Aqua", "Violet"],
  ["Bubblegum", "Sunflower"],
  ["Bubblegum", "Turquoise"],
  ["Fluor Green", "Bubblegum"],
  ["Fluor Pink", "Light Teal"],
  ["Kelly Green", "Orange"],
  ["Light Teal", "Orange"],
  ["Violet", "Neon Coral"],
  ["Yellow", "Aqua"],
  ["Yellow", "Blue"],
  ["Bubblegum", "Kelly Green"],
  ["Bubblegum", "Aqua"],
  ["Bubblegum", "Blue"],
  ["Bubblegum", "Federal Blue"],
].map((pair) =>
  pair.map((name) => RISO_INKS.findIndex((ink) => ink.name === name))
);

const inkSlug = (name) => name.toLowerCase().replace(/\s+/g, "-");

// hash carries the whole recipe: #<seed>[/<ink>,<ink>...]
function buildHash(seed, inkSel) {
  return `#${seedHex(seed)}${inkSel.length ? "/" + inkSel.join(",") : ""}`;
}

function parseHash(hash) {
  const m = /^#([0-9a-f]{1,8})(?:\/(\d+(?:,\d+)*))?$/i.exec(hash);
  if (!m) return null;
  const inks = [];
  if (m[2]) {
    for (const part of m[2].split(",")) {
      const idx = parseInt(part, 10);
      if (
        idx >= 0 &&
        idx < RISO_INKS.length &&
        !inks.includes(idx) &&
        inks.length < MAX_INKS
      ) {
        inks.push(idx);
      }
    }
  }
  return { seed: parseInt(m[1], 16) >>> 0, inks };
}

// ---------------------------------------------------------------- settings

function makeParams(rng) {
  const R = (a, b) => a + rng() * (b - a);
  const RI = (a, b) => Math.floor(R(a, b + 1));

  const cycles = RI(130, 220);
  const T = cycles * TAU;
  const p = { T, cycles, rot0: R(0, TAU), rotDrift: 0 };

  const roll = rng();
  if (roll < 0.45) {
    // amplitude-modulated circle — torus / flower / shell
    p.mode = "am";
    const classic = rng() < 0.5; // bias toward the torus look
    p.q = classic ? RI(4, 8) : RI(2, 9); // tube winding
    p.rho = classic ? R(0.3, 0.5) : R(0.22, 0.65);
    p.gam = classic ? (Math.PI / 2) * R(0.85, 1.15) : R(0, Math.PI);
    p.beta = Math.PI / 2 + R(-0.35, 0.35);
    p.eps = (R(4, 18) * TAU) / T; // modulator detune -> precession
    p.phm = R(0, TAU);
    p.norm = 1 / (1 + p.rho);
  } else if (roll < 0.78) {
    // lissajous with slow precession
    p.mode = "liss";
    p.a = RI(1, 5);
    p.b = RI(1, 5);
    if (p.b === p.a) p.b = (p.a % 5) + 1;
    p.eps = (R(1.5, 9) * TAU) / T;
    p.m = rng() < 0.35 ? 0 : R(0.12, 0.45);
    p.g = rng() < 0.5 ? RI(2, 7) : R(0.3, 2.4);
    p.ph1 = R(0, TAU);
    p.ph2 = R(0, TAU);
    p.ps1 = R(0, TAU);
    p.ps2 = R(0, TAU);
    p.norm = 1 / (1 + p.m);
    p.rotDrift = R(0, 0.12) / T;
  } else {
    // swept figure — the exposure drags the figure through space
    p.mode = "sweep";
    p.a = RI(1, 3);
    p.b = RI(1, 3);
    if (p.b === p.a) p.b = (p.a % 3) + 1;
    p.eps = (R(7, 24) * TAU) / T;
    p.m = R(0, 0.3);
    p.g = R(0.3, 2.0);
    p.ph1 = R(0, TAU);
    p.ph2 = R(0, TAU);
    p.ps1 = R(0, TAU);
    p.ps2 = R(0, TAU);
    p.rotDrift = R(0.4, 2.2) / T;
    p.ampK = R(0.8, 1.6);
    p.ampPh = R(0, TAU);
    p.norm = 1 / (1 + p.m);
  }

  // filter wheel
  const pr = rng();
  if (p.mode === "sweep" && rng() < 0.5) p.pal = "fire";
  else if (p.mode === "am" && rng() < 0.45) p.pal = "mono";
  else
    p.pal =
      pr < 0.35
        ? "mono"
        : pr < 0.6
          ? "redblue"
          : pr < 0.8
            ? "fire"
            : "phosphor";

  p.glowGain = R(0.75, 1.25);
  p.no = RI(1, 1199);
  return p;
}

// ------------------------------------------------------------ accumulation

function splat3(buf, W, x, y, r, g, b) {
  const ix = x | 0;
  const iy = y | 0;
  if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= W - 1) return;
  const fx = x - ix;
  const fy = y - iy;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  let i = (iy * W + ix) * 3;
  buf[i] += r * w00;
  buf[i + 1] += g * w00;
  buf[i + 2] += b * w00;
  i += 3;
  buf[i] += r * w10;
  buf[i + 1] += g * w10;
  buf[i + 2] += b * w10;
  i += (W - 1) * 3;
  buf[i] += r * w01;
  buf[i + 1] += g * w01;
  buf[i + 2] += b * w01;
  i += 3;
  buf[i] += r * w11;
  buf[i + 1] += g * w11;
  buf[i + 2] += b * w11;
}

function splat1(buf, W, x, y, w) {
  const ix = x | 0;
  const iy = y | 0;
  if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= W - 1) return;
  const fx = x - ix;
  const fy = y - iy;
  let i = iy * W + ix;
  buf[i] += (1 - fx) * (1 - fy) * w;
  buf[i + 1] += fx * (1 - fy) * w;
  i += W;
  buf[i] += (1 - fx) * fy * w;
  buf[i + 1] += fx * fy * w;
}

// ------------------------------------------------------------- the exposure

const RB_A = [1, 0.16, 0.08];
const RB_B = [0.2, 0.42, 1.0];
const F_1 = [0.85, 0.05, 0];
const F_2 = [1.0, 0.42, 0.04];
const F_3 = [1.0, 0.88, 0.5];

function createExposure(seed, size, total, inks) {
  const rng = mulberry32(seed);
  const P = makeParams(rng);
  // the ink set overrides the palette but never touches the rng, so the
  // same seed keeps the same figure under any inks
  P.inks = inks && inks.length ? inks : null;
  if (P.inks) P.pal = "riso";

  const S = size;
  const G = S >> 2;
  const jit = S / 1200; // grain scales with resolution
  const core = new Float32Array(S * S * 3);
  const glow = new Float32Array(G * G * 3);
  const layerCount = P.inks ? P.inks.length : CLASSIC_LAYERS;
  const bands = Array.from(
    { length: layerCount },
    () => new Float32Array(S * S)
  );
  const dt = P.T / total;
  let t = 0;

  let bx = 0;
  let by = 0;
  function beam(tt) {
    let x, y;
    if (P.mode === "am") {
      const ph = P.q * tt + P.eps * tt + P.phm;
      x = Math.sin(tt) * (1 + P.rho * Math.sin(ph)) * P.norm;
      y = Math.sin(tt + P.beta) * (1 + P.rho * Math.sin(ph + P.gam)) * P.norm;
    } else {
      x = Math.sin(P.a * tt + P.eps * tt + P.ph1);
      y = Math.sin(P.b * tt + P.ph2);
      if (P.m) {
        x *= 1 + P.m * Math.sin(P.g * tt + P.ps1);
        y *= 1 + P.m * Math.sin(P.g * tt + P.ps2);
      }
      x *= P.norm;
      y *= P.norm;
      if (P.mode === "sweep") {
        const u = tt / P.T;
        x *= 0.62 + 0.38 * Math.sin(Math.PI * P.ampK * u + P.ampPh);
        y *= 0.62 + 0.38 * Math.sin(Math.PI * P.ampK * u + P.ampPh + 1.2);
      }
    }
    const rot = P.rot0 + P.rotDrift * tt;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    bx = x * c - y * s;
    by = x * s + y * c;
  }

  // filter wheel: hue is a function of time through the exposure.
  // also decides which separation band(s) this instant belongs to.
  const NI = P.inks ? P.inks.length : 0;
  const inkRGB = P.inks ? P.inks.map((ink) => ink.rgb) : null;
  const tw = NI > 1 ? 0.32 / NI : 0; // crossfade width between ink holds
  let fR = 0;
  let fG = 0;
  let fB = 0;
  let bandA = 0;
  let bandB = -1;
  let wA = 1;
  let wB = 0;
  function mix3(A, B, k) {
    fR = A[0] + (B[0] - A[0]) * k;
    fG = A[1] + (B[1] - A[1]) * k;
    fB = A[2] + (B[2] - A[2]) * k;
  }
  function wheel(u) {
    if (NI) {
      const k = Math.round(u * NI);
      if (k > 0 && k < NI && Math.abs(u - k / NI) < tw * 0.5) {
        let s = (u - (k / NI - tw * 0.5)) / tw;
        s = s * s * (3 - 2 * s);
        mix3(inkRGB[k - 1], inkRGB[k], s);
        bandA = k - 1;
        bandB = k;
        wA = 1 - s;
        wB = s;
      } else {
        let i = (u * NI) | 0;
        if (i >= NI) i = NI - 1;
        const c = inkRGB[i];
        fR = c[0];
        fG = c[1];
        fB = c[2];
        bandA = i;
        bandB = -1;
        wA = 1;
        wB = 0;
      }
      return;
    }
    bandA = u < 1 / 3 ? 0 : u < 2 / 3 ? 1 : 2;
    bandB = -1;
    wA = 1;
    wB = 0;
    switch (P.pal) {
      case "mono":
        fR = 0.86;
        fG = 0.93;
        fB = 1.0;
        return;
      case "phosphor":
        fR = 0.55;
        fG = 1.0;
        fB = 0.62;
        return;
      case "redblue":
        if (u < 0.42) {
          fR = RB_A[0];
          fG = RB_A[1];
          fB = RB_A[2];
        } else if (u > 0.58) {
          fR = RB_B[0];
          fG = RB_B[1];
          fB = RB_B[2];
        } else {
          const s = (u - 0.42) / 0.16;
          mix3(RB_A, RB_B, s * s * (3 - 2 * s));
        }
        return;
      case "fire":
        if (u < 0.55) mix3(F_1, F_2, u / 0.55);
        else mix3(F_2, F_3, (u - 0.55) / 0.45);
        return;
    }
  }

  const exposure = { P, seed, S, G, core, glow, bands, total, done: 0 };

  exposure.develop = (n) => {
    const cx = S * 0.5;
    const cy = S * 0.5;
    const amp = S * 0.4;
    const gs = G / S;
    for (let i = 0; i < n && exposure.done < total; i++) {
      const u = exposure.done / total;
      wheel(u);
      beam(t);
      const px = cx + bx * amp + g3() * 1.1 * jit;
      const py = cy + by * amp + g3() * 1.1 * jit;
      splat3(core, S, px, py, fR, fG, fB);
      splat3(
        glow,
        G,
        px * gs + g3() * 2.6 * jit,
        py * gs + g3() * 2.6 * jit,
        fR,
        fG,
        fB
      );
      splat1(bands[bandA], S, px, py, wA);
      if (bandB >= 0) splat1(bands[bandB], S, px, py, wB);
      t += dt;
      exposure.done++;
    }
    return exposure.done >= total;
  };

  return exposure;
}

// ------------------------------------------------- tone-map + auto-exposure

function percentile90(buf, W, target) {
  const samp = [];
  const step = Math.max(1, ((W * W) / 6000) | 0);
  for (let p = 0; p < W * W; p += step) {
    const i = p * 3;
    const l = buf[i] + buf[i + 1] + buf[i + 2];
    if (l > 0) samp.push(l);
  }
  if (samp.length < 60) return 1;
  samp.sort((a, b) => a - b);
  return target / Math.max(samp[(samp.length * 0.9) | 0], 1e-6);
}

// shared exposure across separation layers, so relative density survives
function percentileBands(bands, W, target) {
  const samp = [];
  const step = Math.max(1, ((W * W) / 6000) | 0);
  for (let p = 0; p < W * W; p += step) {
    let l = 0;
    for (let b = 0; b < bands.length; b++) l += bands[b][p];
    if (l > 0) samp.push(l);
  }
  if (samp.length < 60) return 1;
  samp.sort((a, b) => a - b);
  return target / Math.max(samp[(samp.length * 0.9) | 0], 1e-6);
}

function writeRGB(px, buf, W, e) {
  const K = (LUT_N / LUT_MAX) * e;
  const n = W * W;
  for (let p = 0, i = 0, j = 0; p < n; p++, i += 3, j += 4) {
    let a = buf[i] * K;
    px[j] = LUT8[a < LUT_N - 1 ? a | 0 : LUT_N - 1];
    a = buf[i + 1] * K;
    px[j + 1] = LUT8[a < LUT_N - 1 ? a | 0 : LUT_N - 1];
    a = buf[i + 2] * K;
    px[j + 2] = LUT8[a < LUT_N - 1 ? a | 0 : LUT_N - 1];
  }
}

// riso master: density -> dark ink on white
function writeMaster(px, band, W, e) {
  const K = (LUT_N / LUT_MAX) * e;
  const n = W * W;
  for (let p = 0, j = 0; p < n; p++, j += 4) {
    const a = band[p] * K;
    const v = 255 - LUT8[a < LUT_N - 1 ? a | 0 : LUT_N - 1];
    px[j] = v;
    px[j + 1] = v;
    px[j + 2] = v;
    px[j + 3] = 255;
  }
}

function makePlane(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const data = ctx.createImageData(size, size);
  const px = data.data;
  for (let j = 3; j < px.length; j += 4) px[j] = 255;
  return { canvas, ctx, data };
}

function makeMapper(coreSize, glowSize) {
  return { core: makePlane(coreSize), glow: makePlane(glowSize) };
}

function toneMap(mapper, exp) {
  writeRGB(
    mapper.core.data.data,
    exp.core,
    exp.S,
    percentile90(exp.core, exp.S, 2.8)
  );
  writeRGB(
    mapper.glow.data.data,
    exp.glow,
    exp.G,
    percentile90(exp.glow, exp.G, 1.2) * exp.P.glowGain
  );
  mapper.core.ctx.putImageData(mapper.core.data, 0, 0);
  mapper.glow.ctx.putImageData(mapper.glow.data, 0, 0);
}

function compositeSquare(mapper, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "lighter";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mapper.core.canvas, 0, 0, size, size);
  ctx.drawImage(mapper.glow.canvas, 0, 0, size, size);
  return canvas;
}

function downloadCanvas(canvas, filename) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve();
      }, 100);
    }, "image/png");
  });
}

const fileBase = (P, seed) =>
  `oscillon-${String(P.no).padStart(4, "0")}-${seedHex(seed)}`;

const MODE_NAMES = {
  am: "amplitude-modulated carrier",
  liss: "lissajous",
  sweep: "swept figure",
};
const PALETTE_NAMES = {
  mono: "monochrome",
  phosphor: "phosphor green",
  redblue: "red→blue wheel",
  fire: "fire wheel",
};

function describe(P, seed) {
  const ratio = P.mode === "am" ? `1:1 carrier · q ${P.q}` : `${P.a}:${P.b}`;
  const palette = P.inks
    ? P.inks.map((ink) => ink.name.toLowerCase()).join(" → ") +
      (P.inks.length > 1 ? " wheel" : " ink")
    : PALETTE_NAMES[P.pal];
  return {
    no: P.no,
    seed: seedHex(seed),
    settings: `${MODE_NAMES[P.mode]} · ${ratio} · ${palette} · ${P.cycles} cycles`,
  };
}

// ----------------------------------------------------------------- the app

function App() {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const engineRef = useRef(null);
  const mapperRef = useRef(null);
  const seedRef = useRef(0);
  const busyRef = useRef(false);
  const rafRef = useRef(0);

  const [info, setInfo] = useState(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(null);
  const [inkSel, setInkSel] = useState(
    () => parseHash(window.location.hash)?.inks ?? []
  );
  const [inksOpen, setInksOpen] = useState(false);

  const inkSelRef = useRef(inkSel);

  const compositeView = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    const exp = engineRef.current;
    const mapper = mapperRef.current;
    if (!canvas || !ctx || !exp || !mapper) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    toneMap(mapper, exp);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const side = Math.min(w, h);
    const ox = (w - side) / 2;
    const oy = (h - side) / 2;
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(mapper.core.canvas, ox, oy, side, side);
    ctx.drawImage(mapper.glow.canvas, ox, oy, side, side);
    ctx.globalCompositeOperation = "source-over";
  }, []);

  const regen = useCallback(
    (seed, writeHash = true) => {
      seedRef.current = seed >>> 0;
      if (writeHash) {
        window.history.replaceState(
          null,
          "",
          buildHash(seedRef.current, inkSelRef.current)
        );
      }
      const inks = inkSelRef.current.map((idx) => RISO_INKS[idx]);
      engineRef.current = createExposure(
        seedRef.current,
        VIEW_SIZE,
        VIEW_SAMPLES,
        inks
      );
      setInfo(describe(engineRef.current.P, seedRef.current));
      setProgress(0);
      compositeView();
    },
    [compositeView]
  );

  const newExposure = useCallback(() => regen(randomSeed()), [regen]);

  // selecting inks recolors the current figure — same seed, new wheel
  const applyInks = useCallback(
    (next) => {
      inkSelRef.current = next;
      setInkSel(next);
      regen(seedRef.current);
    },
    [regen]
  );

  const toggleInk = useCallback(
    (idx) => {
      const cur = inkSelRef.current;
      const next = cur.includes(idx)
        ? cur.filter((i) => i !== idx)
        : cur.length < MAX_INKS
          ? [...cur, idx]
          : cur;
      if (next !== cur) applyInks(next);
    },
    [applyInks]
  );

  const randomCombo = useCallback(() => {
    const pair = RISO_COMBOS[(Math.random() * RISO_COMBOS.length) | 0];
    applyInks(Math.random() < 0.5 ? [...pair] : [...pair].reverse());
  }, [applyInks]);

  const savePng = useCallback(() => {
    const exp = engineRef.current;
    const mapper = mapperRef.current;
    if (!exp || !mapper) return;
    toneMap(mapper, exp);
    downloadCanvas(
      compositeSquare(mapper, VIEW_SIZE),
      `${fileBase(exp.P, exp.seed)}.png`
    );
  }, []);

  const exportPrintMasters = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const seed = seedRef.current;
      const inks = inkSelRef.current.map((idx) => RISO_INKS[idx]);
      const size = VIEW_SIZE * PRINT_SCALE;
      const exp = createExposure(
        seed,
        size,
        VIEW_SAMPLES * PRINT_SCALE * PRINT_SCALE,
        inks
      );
      let finished = false;
      while (!finished) {
        finished = exp.develop(CHUNK * 8);
        setBusy(
          `developing ${size}px masters — ${Math.floor((exp.done / exp.total) * 100)}%`
        );
        await new Promise((r) => setTimeout(r));
      }
      setBusy("writing files…");
      await new Promise((r) => setTimeout(r));
      const mapper = makeMapper(size, exp.G);
      toneMap(mapper, exp);
      const base = fileBase(exp.P, seed);
      await downloadCanvas(compositeSquare(mapper, size), `${base}-print.png`);
      const K = percentileBands(exp.bands, size, 2.8);
      for (let i = 0; i < exp.bands.length; i++) {
        const plane = makePlane(size);
        writeMaster(plane.data.data, exp.bands[i], size, K);
        plane.ctx.putImageData(plane.data, 0, 0);
        const layer = exp.P.inks
          ? `master-${i + 1}-${inkSlug(exp.P.inks[i].name)}`
          : `master-${i + 1}`;
        // browsers throttle rapid successive downloads
        await new Promise((r) => setTimeout(r, 350));
        await downloadCanvas(plane.canvas, `${base}-${layer}.png`);
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    ctxRef.current = canvas.getContext("2d");
    mapperRef.current = makeMapper(VIEW_SIZE, VIEW_SIZE >> 2);

    const parsed = parseHash(window.location.hash);
    regen(parsed ? parsed.seed : randomSeed());

    let frame = 0;
    const loop = () => {
      const exp = engineRef.current;
      if (exp && exp.done < exp.total) {
        const finished = exp.develop(CHUNK);
        frame++;
        if (frame % 5 === 0 || finished) compositeView();
        setProgress(Math.floor((exp.done / exp.total) * 100));
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    const onResize = () => compositeView();
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "s" || e.key === "S") savePng();
      else if (e.key === "e" || e.key === "E") exportPrintMasters();
      else if (e.key === "i" || e.key === "I") setInksOpen((v) => !v);
      else if (
        e.key === "n" ||
        e.key === "N" ||
        (e.key === " " && e.target.tagName !== "BUTTON")
      ) {
        e.preventDefault();
        newExposure();
      }
    };
    const onHash = () => {
      const parsed = parseHash(window.location.hash);
      if (!parsed) return;
      const sameInks =
        parsed.inks.length === inkSelRef.current.length &&
        parsed.inks.every((v, i) => v === inkSelRef.current[i]);
      if (parsed.seed === seedRef.current && sameInks) return;
      inkSelRef.current = parsed.inks;
      setInkSel(parsed.inks);
      regen(parsed.seed, false);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHash);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", onHash);
    };
  }, [regen, compositeView, savePng, exportPrintMasters, newExposure]);

  return (
    <main className="oscillon">
      <canvas
        ref={canvasRef}
        className="oscillon__canvas"
        role="img"
        aria-label="Oscillon — a simulated oscilloscope exposure. Click for a new one."
        onClick={newExposure}
      />
      {info && (
        <footer className="oscillon__caption">
          <p className="oscillon__caption-line oscillon__caption-line--title">
            Oscillon No. {info.no}
          </p>
          <p className="oscillon__caption-line">{info.settings}</p>
          <p className="oscillon__caption-line">
            seed {info.seed} · click — new exposure · S — save png · E — print
            masters · I — inks
          </p>
        </footer>
      )}
      <div className="oscillon__controls">
        <nav className="oscillon__controls-row" aria-label="Exposure controls">
          <button
            type="button"
            className="oscillon__button"
            onClick={newExposure}
            disabled={!!busy}
          >
            new exposure
          </button>
          <button
            type="button"
            className="oscillon__button"
            onClick={savePng}
            disabled={!!busy}
          >
            save png
          </button>
          <button
            type="button"
            className="oscillon__button"
            onClick={exportPrintMasters}
            disabled={!!busy}
          >
            print masters
          </button>
          <button
            type="button"
            className="oscillon__button"
            onClick={() => setInksOpen((v) => !v)}
            aria-expanded={inksOpen}
          >
            inks{inkSel.length ? ` · ${inkSel.length}` : ""}
          </button>
        </nav>
        {inksOpen && (
          <section className="oscillon__inks" aria-label="Risograph inks">
            <p className="oscillon__inks-label">
              risograph inks · pick up to {MAX_INKS} in drum order
            </p>
            <div className="oscillon__ink-grid">
              {RISO_INKS.map((ink, idx) => {
                const order = inkSel.indexOf(idx);
                return (
                  <button
                    key={ink.name}
                    type="button"
                    className={`oscillon__ink${order >= 0 ? " oscillon__ink--selected" : ""}`}
                    style={{ "--ink": ink.hex }}
                    title={ink.name}
                    aria-label={`${ink.name}${order >= 0 ? `, drum ${order + 1}` : ""}`}
                    aria-pressed={order >= 0}
                    data-order={order >= 0 ? order + 1 : undefined}
                    onClick={() => toggleInk(idx)}
                  />
                );
              })}
            </div>
            <div className="oscillon__inks-actions">
              <button
                type="button"
                className="oscillon__button"
                onClick={randomCombo}
              >
                combo
              </button>
              <button
                type="button"
                className="oscillon__button"
                onClick={() => applyInks([])}
                disabled={!inkSel.length}
              >
                clear
              </button>
            </div>
          </section>
        )}
      </div>
      {busy && (
        <p className="oscillon__status" role="status">
          {busy}
        </p>
      )}
      <div
        className={`oscillon__progress${progress >= 100 ? " oscillon__progress--done" : ""}`}
        style={{ "--oscillon-progress": progress / 100 }}
        aria-hidden="true"
      />
    </main>
  );
}

export default App;
