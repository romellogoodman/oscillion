# Rendering Engine

How an Oscillon gets made, and where to touch it. The engine lives in
`src/engine/oscillon-engine.ts`; pure-RGBA composing (no canvas) in
`src/engine/oscillon-raster.ts`; the demo in `src/App.jsx`; the headless
CLI in `scripts/oscillon-render.ts`. Grep symbol names for exact
locations.

## Pipeline

```
seed ──▶ makeParams (seeded rng) ──▶ createExposure
                                        │ develop(n)  · CHUNK samples per rAF frame
                                        ▼
                        core / glow / bands Float32 buffers
                                        │ toneMap  · film response + auto-exposure
                                        ▼
                        offscreen canvases ──▶ additive composite ──▶ display
```

- `createExposure(seed, size, total, inks)` (src/engine/oscillon-engine.ts) builds one
  exposure: params, buffers, and a chunked `develop(n)` closure. The demo
  runs it incrementally from a rAF loop inside `App` so the film "develops"
  live over `DEVELOP_SECONDS` (~12 s — the per-frame sample budget is
  time-based, so pacing is identical at any refresh rate); the CLI runs
  the same function offline, at `PRINT_SIZE` (2400px, ~4× the view
  samples) for masters.
- `beam(tt)` (src/engine/oscillon-engine.ts) is the instrument: X/Y deflection from
  modulated sine pairs, then a slow rotation. Sampled **uniformly in time**,
  so wherever the beam moves slowly (cusps, folds, tangent edges) more
  samples land per pixel and the trace burns brighter. That is the whole
  aesthetic — don't "optimize" it into arc-length sampling.
- `wheel(u)` (src/engine/oscillon-engine.ts) is the filter wheel: exposure progress
  `u ∈ [0,1)` → filter RGB, plus which separation band(s) the sample belongs
  to (`bandA/bandB` with weights summing to 1).
- `splat3`/`splat1` (src/engine/oscillon-engine.ts, 267) deposit bilinearly into the
  buffers. `core` is full-res RGB, `glow` is quarter-res RGB with wider
  jitter (halation), `bands` are single-channel per separation layer.

## Exposure parameters

`makeParams(rng)` (src/engine/oscillon-engine.ts) first rolls an **exposure character**,
then one of four instrument modes.

Characters (matched to the Laposky reference photographs):

- **ghost** (~80% of seeds) — few cycles (12–80), soft wide beam
  (`beamJit`), restrained auto-exposure (`expT` ≈ 1.05–1.9 so veils sit in
  the mid-greys and only caustics burn out), heavy halation (`glowGain`,
  `glowJit`). Leans monochrome.
- **silk** (subset of ghost) — 240–520 cycles with very slow drift, so
  sweeps land within a beam width and fuse into smooth membranes.
- **dense** (~20%) — the original tight-fabric look: 130–220 cycles, sharp
  beam, hot exposure (2.8).

Modes:

- `am` — amplitude-modulated 1:1 circle. `q` tube winding, `rho` modulation
  depth, `eps` modulator detune (makes the tube precess and fill in — the
  torus/flower look).
- `liss` — a:b lissajous with slow phase precession (`eps`) and optional
  secondary AM (`m`, `g`).
- `sweep` — low-order lissajous dragged through space during the exposure
  (`rotDrift`, `ampK`); pairs with the fire palette.
- `spiral` (ghost only) — damped ellipse: amplitude decays to ~0.3–0.6
  radius over the exposure with a drifting center (shell + tail).

Two optional enrichments for ghosts: `h2`, a second-harmonic partial summed
into both deflection axes (Laposky's stacked oscillators — the main source
of shape variety), and `stip`, a third oscillator that chops the beam into
dashes (Z-axis stipple). Both show in the caption (`+3f`, `stippled`).

Determinism rules (also in CLAUDE.md): every draw comes from the seeded
`mulberry32` rng; branch structure decides how many draws happen, which is
fine because the branches themselves are seeded. Append new draws after the
existing ones so old seeds keep producing the same figures. Film grain `g3`
is intentionally unseeded — the figure is deterministic, the grain is not.

## Tone mapping

- Film response `v = 1 − e^(−exposure·density)` via `LUT8` (src/engine/oscillon-engine.ts).
- Auto-exposure pins the 90th percentile of nonzero density
  (`percentile90`); the core target is per-exposure (`P.expT` — ghosts low,
  dense 2.8), glow is 1.2 × `glowGain`.
- `toneMap` (src/engine/oscillon-engine.ts) writes both planes into reusable ImageData;
  composite is black fill + `globalCompositeOperation: "lighter"`.
- The **proof view** (`writeProof`, src/engine/oscillon-engine.ts) is the subtractive
  sibling: separation bands × reflective ink hexes multiplied over paper
  white, with deterministic per-drum misregistration. See
  riso-pipeline.md.

## Contact sheets

Demo: the grid button (or `G`) cycles 1 / 2×2 / 4×4. Sheet mode creates
n² exposures at `size/n` px with proportionally fewer samples each, so
total memory and develop time are constant regardless of grid.
Double-clicking a cell promotes its seed to a single exposure (manual
double-tap detection on pointerdown in `src/App.jsx`). All sheet seeds
travel in the hash, comma-separated.

CLI: `--grid CxR` renders letterboxed contact-sheet pages at any
`--aspect`, logs each cell's seed + settings so pieces can be
re-rendered exactly, and fills pages via `pickDistinctSeeds`
(src/engine/oscillon-engine.ts) — seeds are deduped by `figureSignature`
(mode / ratio / cycles-bucket / harmonic) so a page never repeats a
figure family. `--masters` applies to single pieces only.

## Performance notes

- The view exposure is ~1.7M samples (`VIEW_SAMPLES`); the demo spends
  them over `DEVELOP_SECONDS` with a per-frame budget of
  `total · dt / DEVELOP_SECONDS`. The percentile sort runs on ~6k samples
  per composite — cheap.
- Buffer memory scales with size²: at 2400px print export, core + bands are
  ~70 MB each, transiently. Don't raise `PRINT_SCALE` past 2 without
  chunking exports differently.
- The demo's mapper canvases are created once and reused (`makeMapper`
  in `App`'s mount effect); the CLI has no canvas at all — it composes
  RGBA directly (`src/engine/oscillon-raster.ts`) and writes PNGs with a
  dependency-free encoder (node:zlib).

## Product surfaces

- **Demo** (`src/App.jsx`): one piece blooming on black; click (or
  `N`/space) mints a new seed and auto-rotates the ink combo through
  `RISO_COMBOS`. `S` save png, `P` paper/black, `G` grid. The URL recipe
  hash is the only persistence: read once on mount, written on every
  recipe change.
- **CLI** (`scripts/oscillon-render.ts`, `npm run render -- --help`):
  seeds/random+filters, inks, views, size/aspect, `--masters`, `--grid`,
  and `--video` — which develops one exposure incrementally, snapshots
  each partial develop (`phosphorSquare`/`paperSquare`) as a PNG frame
  in a temp dir, and stitches with ffmpeg (mp4/webm/gif chosen by
  extension, `--duration`, `--fps`, `--hold`).
