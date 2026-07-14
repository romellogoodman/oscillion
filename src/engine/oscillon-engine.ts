/*
  OSCILLON ENGINE — after Ben Laposky (1914–2000)

  A simulated oscilloscope beam: modulated sine signals drive X/Y
  deflection, the beam deposits light into Float32 accumulation buffers
  sampled uniformly in time (the trace brightens wherever the beam
  slows), and a film-response tone map develops the exposure. Color is
  a filter wheel: hue is a function of time through the exposure.

  Deterministic: one 32-bit seed always reproduces its figure. All
  figure randomness flows from the seeded rng in makeParams; film grain
  (g3) is the only sanctioned exception. When adding parameters, append
  new rng() draws after the existing ones so old seeds keep their
  figures.

  Ported unchanged (same seeded draw order) from the pre-Toolcraft
  src/App.jsx at commit 720a690.
*/

const TAU = Math.PI * 2;

export const VIEW_SAMPLES = 1.7e6; // beam samples per 1200px exposure
export const DEVELOP_CHUNK = 10000; // samples per animation frame
export const PRINT_SIZE = 2400; // print masters resolution (px)
export const MAX_INKS = 4;
const CLASSIC_LAYERS = 3; // time bands -> drums for built-in palettes
const BASE_SIZE = 1200; // grain / sample-count reference size

// tone-map LUT: film response  v = 1 - e^(-x)
const LUT_N = 4096;
const LUT_MAX = 9;
const LUT8 = new Uint8Array(LUT_N);
for (let i = 0; i < LUT_N; i++) {
  LUT8[i] = Math.round(255 * (1 - Math.exp((-i * LUT_MAX) / LUT_N)));
}

// cheap gaussian-ish jitter (sd ~0.52) — film grain, deliberately unseeded
const g3 = (): number => Math.random() + Math.random() + Math.random() - 1.5;

// deterministic rng, so one 32-bit seed always reproduces its exposure
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = (): number => (Math.random() * 0x100000000) >>> 0;
export const seedHex = (seed: number): string =>
  (seed >>> 0).toString(16).padStart(8, "0");

export function parseSeedHex(text: string): number | null {
  const m = /^[0-9a-f]{1,8}$/i.exec(text.trim());
  return m ? parseInt(m[0], 16) >>> 0 : null;
}

// ------------------------------------------------------------- riso inks

export type RisoInk = {
  name: string;
  hex: string;
  /** emissive filter color for the phosphor view */
  rgb: [number, number, number];
};

// The Risolve color wheel (risolvestudio.com/products/color-wheel),
// hexcodes via ~/code/onyx/scripts/risograph.ts — onyx is canonical.
const INK_DATA: ReadonlyArray<[string, string]> = [
  ["White", "#ffffff"],
  ["Scarlet", "#f04f55"],
  ["Orange", "#f36d38"],
  ["Sunflower", "#fcb132"],
  ["Yellow", "#ffda23"],
  ["Light Lime", "#d9e256"],
  ["Kelly Green", "#3ca448"],
  ["Agave", "#65aa93"],
  ["Turquoise", "#009977"],
  ["Hunter Green", "#436056"],
  ["Mint", "#80cfd0"],
  ["Light Teal", "#008999"],
  ["Aqua", "#22bde8"],
  ["Cornflower", "#5a96d0"],
  ["Blue", "#007dc2"],
  ["Federal Blue", "#44608c"],
  ["Steel", "#41586b"],
  ["Violet", "#8d79b8"],
  ["Purple", "#614a86"],
  ["Burgundy", "#844f55"],
  ["Brown", "#795645"],
  ["Flat Gold", "#98763c"],
  ["Light Gray", "#9e9c9d"],
  ["Black", "#21201f"],
  ["Peach", "#fdd6c0"],
  ["Fluor Pink", "#f07db1"],
  ["Neon Coral", "#f1729d"],
  ["Fluor Orange", "#fd8288"],
  ["Fluor Yellow", "#e6e983"],
  ["Fluor Green", "#93ce9b"],
  ["Metallic Gold", "#a29280"],
  ["Bisque", "#f1bfa4"],
  ["Bubblegum", "#f280a4"],
  ["Cranberry", "#c04b60"],
];

export function hexToReflect(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ink hexes are reflective (paper); lift them toward emission for the
// phosphor view, but let genuinely dark inks stay dim
function hexToFilter(hex: string): [number, number, number] {
  const c = hexToReflect(hex);
  const k = Math.min(1 / Math.max(c[0], c[1], c[2], 1e-6), 2.5);
  return [c[0] * k, c[1] * k, c[2] * k];
}

export const RISO_INKS: readonly RisoInk[] = INK_DATA.map(([name, hex]) => ({
  hex,
  name,
  rgb: hexToFilter(hex),
}));

// printed-and-proven pairs, May 2024 Risolve stock, via ~/code/onyx
const COMBO_NAMES: ReadonlyArray<[string, string]> = [
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
];

export const RISO_COMBOS: ReadonlyArray<[number, number]> = COMBO_NAMES.map(
  ([a, b]) =>
    [
      RISO_INKS.findIndex((ink) => ink.name === a),
      RISO_INKS.findIndex((ink) => ink.name === b),
    ] as [number, number]
);

export const inkSlug = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, "-");

export function randomInkCombo(): number[] {
  const pair = RISO_COMBOS[(Math.random() * RISO_COMBOS.length) | 0];
  return Math.random() < 0.5 ? [...pair] : [...pair].reverse();
}

// ---------------------------------------------------------------- settings

export type ExposureMode = "am" | "liss" | "spiral" | "sweep";

export type ExposureParams = {
  T: number;
  cycles: number;
  ghost: boolean;
  silk: boolean;
  mode: ExposureMode;
  rot0: number;
  rotDrift: number;
  norm: number;
  pal: string;
  glowGain: number;
  beamJit: number;
  glowJit: number;
  expT: number;
  no: number;
  inks: readonly RisoInk[] | null;
  // mode-specific (present per mode)
  a?: number;
  b?: number;
  q?: number;
  rho?: number;
  gam?: number;
  beta?: number;
  eps?: number;
  phm?: number;
  m?: number;
  g?: number;
  ph1?: number;
  ph2?: number;
  ps1?: number;
  ps2?: number;
  ampK?: number;
  ampPh?: number;
  decay?: number;
  wobble?: number;
  wobF?: number;
  driftX?: number;
  driftY?: number;
  h2?: { k: number; amp: number; ph: number; ph2: number };
  stip?: { f: number; c: number; ph: number };
  axisRatio: number;
  shear: number;
  taper?: { w: number; dir: number };
  scaleJit: number;
  offX: number;
  offY: number;
};

export function makeParams(rng: () => number): ExposureParams {
  const R = (a: number, b: number) => a + rng() * (b - a);
  const RI = (a: number, b: number) => Math.floor(R(a, b + 1));

  // exposure character. Most exposures are ghosts — translucent veils held
  // in the mid-greys (few visible sweeps), or "silk": so many sweeps with
  // so little drift that they fuse into smooth membranes. "dense" is the
  // original tight-fabric look.
  const ghost = rng() < 0.8;
  const silk = ghost && rng() < 0.3;
  const cycles = ghost ? (silk ? RI(240, 520) : RI(12, 80)) : RI(130, 220);
  const T = cycles * TAU;
  const p = {
    T,
    cycles,
    ghost,
    silk,
    rot0: R(0, TAU),
    rotDrift: 0,
  } as ExposureParams;

  const roll = rng();
  if (ghost && roll < 0.14) {
    // damped spiral — amplitude decays through the exposure: shell + tail
    p.mode = "spiral";
    p.beta = Math.PI / 2 + R(-0.45, 0.45);
    p.eps = (R(1.5, 7) * TAU) / T; // slow ellipse precession
    p.decay = R(0.5, 1.3); // shrinks to ~0.3-0.6 radius, never collapses
    p.wobble = R(0, 0.2);
    p.wobF = RI(3, 9);
    p.driftX = R(-0.3, 0.3);
    p.driftY = R(-0.3, 0.3);
    p.norm = 0.95 / (1 + p.wobble);
  } else if (roll < 0.45) {
    // amplitude-modulated circle — torus / flower / shell
    p.mode = "am";
    const classic = rng() < 0.5; // bias toward the torus look
    if (ghost) {
      p.q = RI(2, 7);
      p.rho = R(0.25, 0.7);
      p.eps = (R(1, 5) * TAU) / T; // slow detune -> open sheets
    } else {
      p.q = classic ? RI(4, 8) : RI(2, 9); // tube winding
      p.rho = classic ? R(0.3, 0.5) : R(0.22, 0.65);
      p.eps = (R(4, 18) * TAU) / T; // modulator detune -> precession
    }
    p.gam = classic ? (Math.PI / 2) * R(0.85, 1.15) : R(0, Math.PI);
    p.beta = Math.PI / 2 + R(-0.35, 0.35);
    p.phm = R(0, TAU);
    p.norm = 1 / (1 + (p.rho ?? 0));
  } else if (roll < 0.78) {
    // lissajous with slow precession
    p.mode = "liss";
    const top = ghost ? 4 : 5;
    p.a = RI(1, top);
    p.b = RI(1, top);
    if (p.b === p.a) p.b = (p.a % top) + 1;
    p.eps = ghost ? (R(0.6, 3.5) * TAU) / T : (R(1.5, 9) * TAU) / T;
    p.m = rng() < (ghost ? 0.5 : 0.35) ? 0 : R(0.12, ghost ? 0.35 : 0.45);
    p.g = rng() < 0.5 ? RI(2, 7) : R(0.3, 2.4);
    p.ph1 = R(0, TAU);
    p.ph2 = R(0, TAU);
    p.ps1 = R(0, TAU);
    p.ps2 = R(0, TAU);
    p.norm = 1 / (1 + (p.m ?? 0));
    p.rotDrift = R(0, ghost ? 0.25 : 0.12) / T;
  } else {
    // swept figure — the exposure drags the figure through space
    p.mode = "sweep";
    p.a = RI(1, 3);
    p.b = RI(1, 3);
    if (p.b === p.a) p.b = (p.a % 3) + 1;
    p.eps = ghost ? (R(2, 9) * TAU) / T : (R(7, 24) * TAU) / T;
    p.m = R(0, ghost ? 0.25 : 0.3);
    p.g = R(0.3, 2.0);
    p.ph1 = R(0, TAU);
    p.ph2 = R(0, TAU);
    p.ps1 = R(0, TAU);
    p.ps2 = R(0, TAU);
    p.rotDrift = ghost ? R(0.25, 1.4) / T : R(0.4, 2.2) / T;
    p.ampK = R(0.8, 1.6);
    p.ampPh = R(0, TAU);
    p.norm = 1 / (1 + (p.m ?? 0));
  }

  // a second-harmonic partial stacked into the deflection — Laposky's
  // extra oscillators. Multiplies the shape families without densifying.
  if (ghost && p.mode !== "spiral" && rng() < 0.45) {
    // draw order matters for determinism: k, then amp (reference order)
    const k = RI(2, 5);
    const amp = R(0.1, 0.3);
    p.h2 = { amp, k, ph: R(0, TAU), ph2: R(0, TAU) };
  }

  // filter wheel — ghosts lean monochrome, like the source photographs
  const pr = rng();
  if (ghost) {
    p.pal =
      pr < 0.42
        ? "mono"
        : pr < 0.62
          ? "redblue"
          : pr < 0.82
            ? "fire"
            : "phosphor";
  } else if (p.mode === "sweep" && rng() < 0.5) p.pal = "fire";
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

  // beam and film character: ghosts get a soft wide beam, restrained
  // auto-exposure (veils stay grey, only caustics burn out), heavy halation
  p.beamJit = ghost ? R(1.8, 4.5) : R(0.9, 1.4);
  p.glowJit = ghost ? R(3.5, 7) : 2.6;
  p.expT = ghost ? R(1.05, 1.9) : 2.8;
  p.glowGain = ghost ? R(1.1, 2.1) : R(0.75, 1.25);
  if (ghost && rng() < 0.22) {
    // Z-axis stipple: a third oscillator chops the beam into dashes.
    // Draw order matters for determinism: f, then duty (reference order).
    const f = RI(10, 36);
    const c = Math.cos(Math.PI * R(0.45, 0.72));
    p.stip = { c, f, ph: R(0, TAU) };
  }
  p.no = RI(1, 1199);

  // figure-vocabulary widening (appended draws, 2026-07-13): breaks the
  // 1:1-circle monotony with axis anisotropy, shear, and taper, and
  // varies composition so sheets stop reading as rows of near-twins.
  p.axisRatio = rng() < 0.4 ? R(0.55, 0.95) : 1;
  p.shear = rng() < 0.3 ? R(-0.35, 0.35) : 0;
  p.taper =
    ghost && rng() < 0.3
      ? { dir: rng() < 0.5 ? 1 : -1, w: R(0.25, 0.55) }
      : undefined;
  p.scaleJit = R(0.78, 1.02);
  p.offX = R(-0.08, 0.08);
  p.offY = R(-0.08, 0.08);

  p.inks = null;
  return p;
}

// sheet picks reroll against a coarse family signature so one page
// doesn't fill up with near-twin figures
export function pickDistinctSeeds(
  count: number,
  character: CharacterFilter,
  figure: FigureFilter
): number[] {
  const seen = new Set<string>();
  const seeds: number[] = [];
  for (let i = 0; i < count; i++) {
    let chosen = pickSeed(character, figure);
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = attempt === 0 ? chosen : pickSeed(character, figure);
      const sig = figureSignature(makeParams(mulberry32(candidate)));
      if (!seen.has(sig)) {
        seen.add(sig);
        chosen = candidate;
        break;
      }
      chosen = candidate;
    }
    seeds.push(chosen);
  }
  return seeds;
}

/** coarse family signature used to de-duplicate sheet picks */
export function figureSignature(P: ExposureParams): string {
  const ratio = P.mode === "am" ? `q${P.q}` : `${P.a ?? 1}:${P.b ?? 1}`;
  const cyclesBucket = P.silk ? "silk" : P.cycles < 30 ? "sparse" : "mid";
  return `${P.mode}/${ratio}/${cyclesBucket}/${P.h2 ? "h" + P.h2.k : "plain"}`;
}

// generator filters: constrain what the next exposure rolls. A cheap
// reroll against makeParams (no buffers) — the picked seed still
// reproduces on its own, so filters never travel in recipes.
export type CharacterFilter = "any" | "dense" | "ghost" | "silk";
export type FigureFilter = "any" | ExposureMode;

export function pickSeed(
  charFilter: CharacterFilter,
  figureFilter: FigureFilter
): number {
  for (let i = 0; i < 400; i++) {
    const seed = randomSeed();
    if (charFilter === "any" && figureFilter === "any") return seed;
    const P = makeParams(mulberry32(seed));
    const charOk =
      charFilter === "any" ||
      (charFilter === "silk"
        ? P.silk
        : charFilter === "ghost"
          ? P.ghost && !P.silk
          : !P.ghost);
    if (charOk && (figureFilter === "any" || P.mode === figureFilter)) {
      return seed;
    }
  }
  return randomSeed(); // impossible combination (e.g. dense spiral)
}

// ------------------------------------------------------------ accumulation

function splat3(
  buf: Float32Array,
  W: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number
): void {
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

function splat1(
  buf: Float32Array,
  W: number,
  x: number,
  y: number,
  w: number
): void {
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

export type Exposure = {
  P: ExposureParams;
  seed: number;
  S: number;
  G: number;
  core: Float32Array;
  glow: Float32Array;
  bands: Float32Array[];
  total: number;
  done: number;
  /** advance n beam samples; returns true when fully developed */
  develop: (n: number) => boolean;
};

export function samplesForSize(size: number): number {
  return Math.round(VIEW_SAMPLES * (size / BASE_SIZE) ** 2);
}

export type ExposureBuffers = {
  bands: Float32Array[];
  core: Float32Array;
  glow: Float32Array;
};

export function bandCountFor(inkCount: number): number {
  return inkCount > 0 ? inkCount : CLASSIC_LAYERS;
}

/** allocate the accumulation buffers for an exposure of the given size */
export function allocateExposureBuffers(
  size: number,
  inkCount: number
): ExposureBuffers {
  const G = size >> 2;
  return {
    bands: Array.from(
      { length: bandCountFor(inkCount) },
      () => new Float32Array(size * size)
    ),
    core: new Float32Array(size * size * 3),
    glow: new Float32Array(G * G * 3),
  };
}

export function createExposure(
  seed: number,
  size: number,
  total: number,
  inks: readonly RisoInk[],
  buffers?: ExposureBuffers
): Exposure {
  const rng = mulberry32(seed);
  const P = makeParams(rng);
  // the ink set overrides the palette but never touches the rng, so the
  // same seed keeps the same figure under any inks
  P.inks = inks.length ? inks : null;
  if (P.inks) P.pal = "riso";

  const S = size;
  const G = S >> 2;
  const jit = S / BASE_SIZE; // grain scales with resolution
  const allocated = buffers ?? allocateExposureBuffers(S, inks.length);
  const core = allocated.core;
  const glow = allocated.glow;
  const bands = allocated.bands;
  const dt = P.T / total;
  let t = 0;

  let bx = 0;
  let by = 0;
  function beam(tt: number): void {
    let x: number;
    let y: number;
    if (P.mode === "spiral") {
      const u = tt / P.T;
      const r =
        Math.exp(-(P.decay ?? 1) * u) *
        (1 + (P.wobble ?? 0) * Math.sin((P.wobF ?? 1) * tt)) *
        P.norm;
      x = Math.sin(tt + (P.eps ?? 0) * tt) * r + (P.driftX ?? 0) * u;
      y = Math.sin(tt + (P.beta ?? 0)) * r + (P.driftY ?? 0) * u;
    } else if (P.mode === "am") {
      const ph = (P.q ?? 1) * tt + (P.eps ?? 0) * tt + (P.phm ?? 0);
      x = Math.sin(tt) * (1 + (P.rho ?? 0) * Math.sin(ph)) * P.norm;
      y =
        Math.sin(tt + (P.beta ?? 0)) *
        (1 + (P.rho ?? 0) * Math.sin(ph + (P.gam ?? 0))) *
        P.norm;
    } else {
      x = Math.sin((P.a ?? 1) * tt + (P.eps ?? 0) * tt + (P.ph1 ?? 0));
      y = Math.sin((P.b ?? 1) * tt + (P.ph2 ?? 0));
      if (P.m) {
        x *= 1 + P.m * Math.sin((P.g ?? 1) * tt + (P.ps1 ?? 0));
        y *= 1 + P.m * Math.sin((P.g ?? 1) * tt + (P.ps2 ?? 0));
      }
      x *= P.norm;
      y *= P.norm;
      if (P.mode === "sweep") {
        const u = tt / P.T;
        x *=
          0.62 + 0.38 * Math.sin(Math.PI * (P.ampK ?? 1) * u + (P.ampPh ?? 0));
        y *=
          0.62 +
          0.38 * Math.sin(Math.PI * (P.ampK ?? 1) * u + (P.ampPh ?? 0) + 1.2);
      }
    }
    if (P.h2) {
      const hn = 1 / (1 + P.h2.amp);
      x = (x + P.h2.amp * Math.sin(P.h2.k * tt + P.h2.ph)) * hn;
      y = (y + P.h2.amp * Math.sin(P.h2.k * tt + P.h2.ph2)) * hn;
    }
    x *= P.axisRatio;
    if (P.taper) y *= 1 - P.taper.w * ((P.taper.dir * x + 1) * 0.5);
    if (P.shear) x += P.shear * y;
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
  function mix3(A: readonly number[], B: readonly number[], k: number): void {
    fR = A[0] + (B[0] - A[0]) * k;
    fG = A[1] + (B[1] - A[1]) * k;
    fB = A[2] + (B[2] - A[2]) * k;
  }
  function wheel(u: number): void {
    if (NI && inkRGB) {
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

  const exposure: Exposure = {
    G,
    P,
    S,
    bands,
    core,
    develop: (n: number) => {
      const cx = S * 0.5;
      const cy = S * 0.5;
      const amp = S * 0.4;
      const gs = G / S;
      for (let i = 0; i < n && exposure.done < total; i++) {
        const u = exposure.done / total;
        wheel(u);
        beam(t);
        let e = 1;
        if (P.stip && Math.sin(P.stip.f * t + P.stip.ph) < P.stip.c) e = 0.12;
        const px = cx + bx * amp + g3() * P.beamJit * jit;
        const py = cy + by * amp + g3() * P.beamJit * jit;
        splat3(core, S, px, py, fR * e, fG * e, fB * e);
        splat3(
          glow,
          G,
          px * gs + g3() * P.glowJit * jit,
          py * gs + g3() * P.glowJit * jit,
          fR * e,
          fG * e,
          fB * e
        );
        splat1(bands[bandA], S, px, py, wA * e);
        if (bandB >= 0) splat1(bands[bandB], S, px, py, wB * e);
        t += dt;
        exposure.done++;
      }
      return exposure.done >= total;
    },
    done: 0,
    glow,
    seed,
    total,
  };

  return exposure;
}

// ------------------------------------------------- tone-map + auto-exposure

function percentile90(buf: Float32Array, W: number, target: number): number {
  const samp: number[] = [];
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
export function percentileBands(
  bands: readonly Float32Array[],
  W: number,
  target: number
): number {
  const samp: number[] = [];
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

export function writeRGB(
  px: Uint8ClampedArray,
  buf: Float32Array,
  W: number,
  e: number
): void {
  const K = (LUT_N / LUT_MAX) * e;
  const n = W * W;
  for (let p = 0, i = 0, j = 0; p < n; p++, i += 3, j += 4) {
    let a = buf[i] * K;
    px[j] = LUT8[a < LUT_N - 1 ? a | 0 : LUT_N - 1];
    a = buf[i + 1] * K;
    px[j + 1] = LUT8[a < LUT_N - 1 ? a | 0 : LUT_N - 1];
    a = buf[i + 2] * K;
    px[j + 2] = LUT8[a < LUT_N - 1 ? a | 0 : LUT_N - 1];
    px[j + 3] = 255;
  }
}

// riso master: density -> dark ink on white
export function writeMaster(
  px: Uint8ClampedArray,
  band: Float32Array,
  W: number,
  e: number
): void {
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

export const PROOF_BLACK = hexToReflect("#21201f"); // no inks -> riso Black

// print proof: translucent ink layers multiplied over the paper color,
// with a little deterministic per-drum misregistration
export function writeProof(
  px: Uint8ClampedArray,
  exp: Exposure,
  W: number,
  paper: [number, number, number]
): void {
  const bands = exp.bands;
  const N = bands.length;
  const K = (LUT_N / LUT_MAX) * percentileBands(bands, W, 2.2);
  const inks = exp.P.inks
    ? exp.P.inks.map((ink) => hexToReflect(ink.hex))
    : bands.map(() => PROOF_BLACK);
  const mr = mulberry32(exp.seed ^ 0x9e3779b9);
  const mis = inks.map(() => [
    Math.round((mr() * 2 - 1) * 3 * (W / BASE_SIZE)),
    Math.round((mr() * 2 - 1) * 3 * (W / BASE_SIZE)),
  ]);
  for (let y = 0, j = 0; y < W; y++) {
    for (let x = 0; x < W; x++, j += 4) {
      let r = paper[0];
      let g = paper[1];
      let b = paper[2];
      for (let n = 0; n < N; n++) {
        const sx = x - mis[n][0];
        const sy = y - mis[n][1];
        if (sx < 0 || sy < 0 || sx >= W || sy >= W) continue;
        const a = bands[n][sy * W + sx] * K;
        const c = LUT8[a < LUT_N - 1 ? a | 0 : LUT_N - 1] / 255;
        if (!c) continue;
        const ink = inks[n];
        r *= 1 - c + c * ink[0];
        g *= 1 - c + c * ink[1];
        b *= 1 - c + c * ink[2];
      }
      px[j] = r * 255;
      px[j + 1] = g * 255;
      px[j + 2] = b * 255;
      px[j + 3] = 255;
    }
  }
}

// ------------------------------------------------------------- compositing

export type Plane = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  data: ImageData;
};

export function makePlane(size: number): Plane {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  // no alpha prefill: every writer sets px[j+3] itself, and skipping the
  // prefill keeps 16-cell sheet mapper allocation off the long-task list
  const data = ctx.createImageData(size, size);
  return { canvas, ctx, data };
}

export type Mapper = {
  core: Plane;
  glow: Plane;
  proof: Plane;
  /** half-resolution proof used while a develop is still in progress */
  proofSmall: Plane;
};

export function makeMapper(coreSize: number, glowSize: number): Mapper {
  return {
    core: makePlane(coreSize),
    glow: makePlane(glowSize),
    proof: makePlane(coreSize),
    // capped so the per-refresh progress pass stays a short task even
    // at the 2400px develop cap; the final composite is full resolution
    proofSmall: makePlane(Math.min(600, Math.max(64, coreSize >> 1))),
  };
}

/** auto-exposure gains for the phosphor planes (core + glow) */
export function toneGains(exp: Exposure): { core: number; glow: number } {
  return {
    core: percentile90(exp.core, exp.S, exp.P.expT),
    glow: percentile90(exp.glow, exp.G, 1.2) * exp.P.glowGain,
  };
}

/** develop the phosphor planes (core + glow) from the exposure buffers */
export function toneMap(mapper: Mapper, exp: Exposure): void {
  writeRGB(
    mapper.core.data.data,
    exp.core,
    exp.S,
    percentile90(exp.core, exp.S, exp.P.expT)
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

/** develop the paper-proof plane from the separation bands */
export function proofMap(
  mapper: Mapper,
  exp: Exposure,
  paper: [number, number, number]
): void {
  writeProof(mapper.proof.data.data, exp, exp.S, paper);
  mapper.proof.ctx.putImageData(mapper.proof.data, 0, 0);
}

// progress-quality proof: sample the bands at half resolution so the
// live develop preview stays a short task; the final composite always
// rewrites the full-resolution proof
export function proofMapProgress(
  mapper: Mapper,
  exp: Exposure,
  paper: [number, number, number]
): void {
  const small = mapper.proofSmall;
  const W = small.canvas.width;
  const px = small.data.data;
  const bands = exp.bands;
  const N = bands.length;
  const S = exp.S;
  const step = S / W;
  const K = (LUT_N / LUT_MAX) * percentileBands(bands, S, 2.2);
  const inks = exp.P.inks
    ? exp.P.inks.map((ink) => hexToReflect(ink.hex))
    : bands.map(() => PROOF_BLACK);
  for (let y = 0, j = 0; y < W; y++) {
    const sy = Math.min(S - 1, (y * step) | 0);
    for (let x = 0; x < W; x++, j += 4) {
      const sx = Math.min(S - 1, (x * step) | 0);
      let r = paper[0];
      let g = paper[1];
      let b = paper[2];
      const i = sy * S + sx;
      for (let n = 0; n < N; n++) {
        const a = bands[n][i] * K;
        const c = LUT8[a < LUT_N - 1 ? a | 0 : LUT_N - 1] / 255;
        if (!c) continue;
        const ink = inks[n];
        r *= 1 - c + c * ink[0];
        g *= 1 - c + c * ink[1];
        b *= 1 - c + c * ink[2];
      }
      px[j] = r * 255;
      px[j + 1] = g * 255;
      px[j + 2] = b * 255;
      px[j + 3] = 255;
    }
  }
  small.ctx.putImageData(small.data, 0, 0);
}

/** draw one developed exposure into a square region of a 2d context */
export function drawExposureTile(
  ctx: CanvasRenderingContext2D,
  exp: Exposure,
  mapper: Mapper,
  x: number,
  y: number,
  size: number,
  view: "paper" | "phosphor",
  paper: [number, number, number],
  quality: "final" | "progress" = "final"
): void {
  if (view === "paper") {
    if (quality === "progress") {
      proofMapProgress(mapper, exp, paper);
      ctx.drawImage(mapper.proofSmall.canvas, x, y, size, size);
      return;
    }
    proofMap(mapper, exp, paper);
    ctx.drawImage(mapper.proof.canvas, x, y, size, size);
    return;
  }
  toneMap(mapper, exp);
  const prev = ctx.globalCompositeOperation;
  ctx.fillStyle = "#000";
  ctx.fillRect(x, y, size, size);
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(mapper.core.canvas, x, y, size, size);
  ctx.drawImage(mapper.glow.canvas, x, y, size, size);
  ctx.globalCompositeOperation = prev;
}

// ------------------------------------------------------------------ recipe

export const fileBase = (P: ExposureParams, seed: number): string =>
  `oscillon-${String(P.no).padStart(4, "0")}-${seedHex(seed)}`;

const MODE_NAMES: Record<ExposureMode, string> = {
  am: "amplitude-modulated carrier",
  liss: "lissajous",
  spiral: "damped spiral",
  sweep: "swept figure",
};
const PALETTE_NAMES: Record<string, string> = {
  fire: "fire wheel",
  mono: "monochrome",
  phosphor: "phosphor green",
  redblue: "red→blue wheel",
};

export function describe(P: ExposureParams, seed: number) {
  const ratio =
    P.mode === "am"
      ? `1:1 carrier · q ${P.q}`
      : P.mode === "spiral"
        ? "1:1 damped"
        : `${P.a}:${P.b}`;
  const palette = P.inks
    ? P.inks.map((ink) => ink.name.toLowerCase()).join(" → ") +
      (P.inks.length > 1 ? " wheel" : " ink")
    : PALETTE_NAMES[P.pal];
  const character = P.silk ? " · silk" : P.ghost ? " · ghost" : "";
  const harmonic = P.h2 ? ` · +${P.h2.k}f` : "";
  const stippled = P.stip ? " · stippled" : "";
  return {
    no: P.no,
    seed: seedHex(seed),
    settings: `${MODE_NAMES[P.mode]} · ${ratio}${harmonic} · ${palette} · ${P.cycles} cycles${character}${stippled}`,
  };
}

export function downloadCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
  mime: string = "image/png"
): Promise<void> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve();
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve();
      }, 100);
    }, mime);
  });
}

/** develop an exposure off-screen in chunks, yielding to the event loop */
export async function developOffline(
  exp: Exposure,
  onProgress?: (fraction: number) => void
): Promise<void> {
  let finished = false;
  while (!finished) {
    finished = exp.develop(DEVELOP_CHUNK * 8);
    onProgress?.(exp.done / exp.total);
    await new Promise((r) => setTimeout(r));
  }
}
