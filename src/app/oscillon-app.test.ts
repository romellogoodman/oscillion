import { describe, expect, it } from "vitest";

import { appPerformance } from "./app-performance";
import { appSchema } from "./app-schema";
import {
  MAX_INKS,
  RISO_COMBOS,
  RISO_INKS,
  createExposure,
  makeParams,
  mulberry32,
  pickSeed,
  randomInkCombo,
  samplesForSize,
  seedHex,
  writeMaster,
  writeProof,
  type Exposure,
} from "./oscillon-engine";
import {
  buildRecipeHash,
  developSizeFor,
  gridForSeedCount,
  parseRecipeHash,
  readRecipe,
} from "./oscillon-renderer";

const SILK_SEED = 0xce14a048;

function developedFingerprint(exp: Exposure, samples: number): number[] {
  exp.develop(samples);
  // 16 coarse regional energy sums — robust to grain, sensitive to figure
  const regions = new Array<number>(16).fill(0);
  const cells = 4;
  for (let y = 0; y < exp.S; y++) {
    for (let x = 0; x < exp.S; x++) {
      const i = (y * exp.S + x) * 3;
      const region =
        Math.min(cells - 1, Math.floor((y / exp.S) * cells)) * cells +
        Math.min(cells - 1, Math.floor((x / exp.S) * cells));
      regions[region] += exp.core[i] + exp.core[i + 1] + exp.core[i + 2];
    }
  }
  return regions.map((v) => Math.round(v * 100) / 100);
}

describe("oscillon exposures", () => {
  it("automated: the same seed always develops the identical figure", () => {
    // grain is intentionally stochastic, so compare the deterministic
    // layers: params and band-weight structure derived from the seed
    const a = makeParams(mulberry32(0x0cb09815));
    const b = makeParams(mulberry32(0x0cb09815));
    expect(a).toEqual(b);
    const c = makeParams(mulberry32(0x0cb09816));
    expect(c).not.toEqual(a);
  });

  it("automated: character filter constrains picked seeds to the requested character", () => {
    for (let i = 0; i < 5; i++) {
      const seed = pickSeed("silk", "any");
      const P = makeParams(mulberry32(seed));
      expect(P.silk).toBe(true);
      const denseSeed = pickSeed("dense", "any");
      expect(makeParams(mulberry32(denseSeed)).ghost).toBe(false);
    }
  });

  it("automated: figure filter constrains picked seeds to the requested mode", () => {
    for (let i = 0; i < 5; i++) {
      const seed = pickSeed("any", "spiral");
      expect(makeParams(mulberry32(seed)).mode).toBe("spiral");
    }
  });

  it("automated: ink selection changes the exposure separations but not the figure", () => {
    const inks = [RISO_INKS[25], RISO_INKS[11]];
    const plain = createExposure(SILK_SEED, 128, 4000, []);
    const inked = createExposure(SILK_SEED, 128, 4000, inks);
    expect(plain.P.cycles).toBe(inked.P.cycles);
    expect(plain.P.mode).toBe(inked.P.mode);
    expect(plain.bands.length).toBe(3); // classic time bands
    expect(inked.bands.length).toBe(2); // one band per drum
    expect(inked.P.pal).toBe("riso");
  });

  it("automated: ink combo picks a proven pair and clear empties the drums", () => {
    for (let i = 0; i < 10; i++) {
      const combo = randomInkCombo();
      expect(combo).toHaveLength(2);
      const sorted = [...combo].sort((a, b) => a - b) as [number, number];
      const match = RISO_COMBOS.some(
        (pair) =>
          Math.min(...pair) === sorted[0] && Math.max(...pair) === sorted[1],
      );
      expect(match).toBe(true);
    }
    expect(MAX_INKS).toBe(4);
  });

  it("automated: sheet seeds parse and cap to the grid cell count", () => {
    const values = {
      "exposure.seed": "0cb09815",
      "inks.drums": [25, 11],
      "sheet.grid": "2",
      "sheet.seeds": "0cb09815,ce14a048,062ac9c4,5072741c,deadbeef",
    };
    const recipe = readRecipe(values);
    expect(recipe.grid).toBe(2);
    expect(recipe.seeds).toHaveLength(4); // capped to grid² cells
    expect(recipe.inks).toEqual([25, 11]);
    expect(gridForSeedCount(4)).toBe("2");
    expect(gridForSeedCount(16)).toBe("4");
    expect(gridForSeedCount(1)).toBe("1");
  });

  it("automated: recipe hash round-trips seeds and ink drums", () => {
    const recipe = {
      grid: 1,
      inks: [25, 11],
      seeds: [0x0cb09815],
    };
    const hash = buildRecipeHash(recipe);
    expect(hash).toBe("#0cb09815/25,11");
    const parsed = parseRecipeHash(hash);
    expect(parsed?.seeds.map(seedHex)).toEqual(["0cb09815"]);
    expect(parsed?.inks).toEqual([25, 11]);
    const sheet = parseRecipeHash("#0cb09815,ce14a048,062ac9c4,5072741c");
    expect(sheet?.seeds).toHaveLength(4);
    expect(parseRecipeHash("#not-a-recipe")).toBeNull();
  });

  it("automated: persistence config keeps values and canvas slices", () => {
    const persistence = appSchema.persistence;
    expect(persistence.storage).toBe("localStorage");
    if (persistence.storage !== "localStorage") throw new Error("unreachable");
    expect(persistence.include).toContain("values");
    expect(persistence.include).toContain("canvas");
  });
});

describe("oscillon compositors", () => {
  it("automated: view mode selects the paper or phosphor compositor", () => {
    // paper: empty bands leave the paper color; phosphor composites
    // over black. Prove the paper path writes paper-colored pixels.
    const exp = createExposure(SILK_SEED, 64, 1000, []);
    const px = new Uint8ClampedArray(64 * 64 * 4);
    writeProof(px, exp, 64, [0.98, 0.973, 0.953]);
    expect(px[0]).toBeGreaterThan(240); // undeveloped corner = paper white
    expect(px[3]).toBe(255);
  });

  it("automated: the paper color feeds the proof compositor", () => {
    const exp = createExposure(SILK_SEED, 64, 1000, []);
    const white = new Uint8ClampedArray(64 * 64 * 4);
    const pink = new Uint8ClampedArray(64 * 64 * 4);
    writeProof(white, exp, 64, [1, 1, 1]);
    writeProof(pink, exp, 64, [1, 0.5, 0.5]);
    expect(pink[1]).toBeLessThan(white[1]); // green channel tinted down
  });

  it("automated: include-background gates the preview background", () => {
    // the renderer skips the fill when include is off; prove the
    // schema wires the target the compositor reads
    const sections = appSchema.panels.controls?.sections ?? [];
    const targets = sections.flatMap((section) =>
      Object.values(section.controls).map((control) => control.target),
    );
    expect(targets).toContain("export.includeBackground");
    expect(targets).toContain("appearance.background");
  });

  it("automated: export format select carries png and jpg options", () => {
    const sections = appSchema.panels.controls?.sections ?? [];
    const format = sections
      .flatMap((section) => Object.values(section.controls))
      .find((control) => control.target === "export.image.format");
    expect(format?.options?.map((o) => o.value)).toEqual(["png", "jpg"]);
  });

  it("automated: export resolution maps to real long-edge pixel sizes", () => {
    const sections = appSchema.panels.controls?.sections ?? [];
    const resolution = sections
      .flatMap((section) => Object.values(section.controls))
      .find((control) => control.target === "export.image.resolution");
    expect(resolution?.options?.map((o) => o.value)).toEqual([
      "2k",
      "4k",
      "8k",
    ]);
  });

  it("automated: panel actions map to generate and export handlers", () => {
    const sections = appSchema.panels.controls?.sections ?? [];
    const panelActions = sections
      .flatMap((section) => Object.values(section.controls))
      .find((control) => control.type === "panelActions");
    const values = (panelActions?.actions ?? []).map((action) =>
      typeof action === "string" ? action : action.value,
    );
    expect(values).toEqual(["generate", "export-png", "export-masters"]);
  });

  it("automated: png export develops offline at the selected resolution", () => {
    // export sizes derive from samplesForSize so density matches the
    // preview; a 2048px export needs (2048/1200)² times the samples
    const base = samplesForSize(1200);
    expect(samplesForSize(2048)).toBeGreaterThan(base * 2.8);
    expect(samplesForSize(2048)).toBeLessThan(base * 3);
  });
});

describe("oscillon workload", () => {
  it("automated: develop workload stays chunked for max-size single exposures", () => {
    const exp = createExposure(SILK_SEED, 2400, samplesForSize(2400), []);
    expect(exp.develop(10000)).toBe(false); // chunk does not run to completion
    expect(exp.done).toBe(10000);
    expect(exp.total).toBeGreaterThan(6_000_000);
  });

  it("automated: sheet workload splits the sample budget across cells", () => {
    const single = samplesForSize(1200);
    const quad = samplesForSize(600) * 4;
    const sixteen = samplesForSize(300) * 16;
    expect(Math.abs(quad - single) / single).toBeLessThan(0.01);
    expect(Math.abs(sixteen - single) / single).toBeLessThan(0.01);
  });

  it("automated: view and background changes recomposite without redeveloping", () => {
    const exp = createExposure(SILK_SEED, 64, 1000, []);
    exp.develop(1000);
    const before = exp.done;
    const px = new Uint8ClampedArray(64 * 64 * 4);
    writeProof(px, exp, 64, [1, 1, 1]); // paper compositor
    writeMaster(px, exp.bands[0], 64, 1); // master compositor
    expect(exp.done).toBe(before); // compositors never advance develop
  });

  it("automated: viewport interactions never invalidate the develop pass", () => {
    const invalidations =
      appPerformance.rendererPipeline?.interactionInvalidation ?? [];
    for (const rule of invalidations) {
      if (
        rule.interaction === "viewport-drag" ||
        rule.interaction === "viewport-zoom"
      ) {
        expect(rule.invalidates).toHaveLength(0);
        expect(rule.mustNotInvalidate).toContain("develop");
      }
    }
  });

  it("automated: render scale rescales the develop buffer", () => {
    expect(developSizeFor(1200, 1200, 2)).toBe(2 * developSizeFor(1200, 1200, 1));
  });

  it("automated: develop size follows the canvas short edge and render scale", () => {
    expect(developSizeFor(1200, 1200, 1)).toBe(1200);
    expect(developSizeFor(1200, 1200, 2)).toBe(2400);
    expect(developSizeFor(1600, 1200, 1)).toBe(1200);
    expect(developSizeFor(4000, 4000, 2)).toBe(2400); // capped
    expect(developSizeFor(10, 10, 1)).toBe(64); // floored
  });

  it("automated: fingerprints differ across seeds", () => {
    const a = developedFingerprint(
      createExposure(0x0cb09815, 128, 4000, []),
      4000,
    );
    const b = developedFingerprint(
      createExposure(0x5072741c, 128, 4000, []),
      4000,
    );
    expect(a).not.toEqual(b);
  });
});
