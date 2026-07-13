# Rendering Engine

How an Oscillon gets made, and where to touch it. Everything lives in
`src/App.jsx`. Line numbers drift as the file is edited — grep the symbol
name if a reference misses.

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

- `createExposure(seed, size, total, inks)` (src/App.jsx:289) builds one
  exposure: params, buffers, and a chunked `develop(n)` closure. The view
  runs it incrementally from a rAF loop inside `App` so the film "develops"
  live; print export runs the same function offline at 2× size, 4× samples.
- `beam(tt)` (src/App.jsx:312) is the instrument: X/Y deflection from
  modulated sine pairs, then a slow rotation. Sampled **uniformly in time**,
  so wherever the beam moves slowly (cusps, folds, tangent edges) more
  samples land per pixel and the trace burns brighter. That is the whole
  aesthetic — don't "optimize" it into arc-length sampling.
- `wheel(u)` (src/App.jsx:357) is the filter wheel: exposure progress
  `u ∈ [0,1)` → filter RGB, plus which separation band(s) the sample belongs
  to (`bandA/bandB` with weights summing to 1).
- `splat3`/`splat1` (src/App.jsx:239, 267) deposit bilinearly into the
  buffers. `core` is full-res RGB, `glow` is quarter-res RGB with wider
  jitter (halation), `bands` are single-channel per separation layer.

## Exposure parameters

`makeParams(rng)` (src/App.jsx:164) first rolls an **exposure character**,
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

- Film response `v = 1 − e^(−exposure·density)` via `LUT8` (src/App.jsx:42).
- Auto-exposure pins the 90th percentile of nonzero density
  (`percentile90`); the core target is per-exposure (`P.expT` — ghosts low,
  dense 2.8), glow is 1.2 × `glowGain`.
- `toneMap` (src/App.jsx:648) writes both planes into reusable ImageData;
  composite is black fill + `globalCompositeOperation: "lighter"`.
- The **proof view** (`writeProof`, src/App.jsx:587) is the subtractive
  sibling: separation bands × reflective ink hexes multiplied over paper
  white, with deterministic per-drum misregistration. See
  riso-pipeline.md.

## Contact sheets

`grid` 1 / 2×2 / 4×4 (G key): sheet mode creates n² exposures at
`VIEW_SIZE/n` px with `VIEW_SAMPLES/n²` samples each, so total memory and
develop time are constant regardless of grid. Clicking a cell promotes its
seed to a full-res single exposure (`handleCanvasClick` in `App`). Masters
export is disabled in sheet mode; save png saves the whole sheet.

## Performance notes

- `CHUNK` samples per animation frame (src/App.jsx:34); the view exposure is
  ~1.7M samples ≈ 3 s at 60 fps. The percentile sort runs on ~6k samples per
  composite — cheap.
- Buffer memory scales with size²: at 2400px print export, core + bands are
  ~70 MB each, transiently. Don't raise `PRINT_SCALE` past 2 without
  chunking exports differently.
- The view's mapper canvases are created once and reused (`makeMapper` in
  `App`'s mount effect); exports create their own throwaway set.

## React integration

- All engine state lives in refs (`engineRef`, `seedRef`, `inkSelRef`);
  React state is only caption info, progress, busy text, and UI toggles.
- The mount effect (in `App`, src/App.jsx:601) wires the rAF loop, resize,
  keydown, and hashchange listeners, and is StrictMode-safe: cleanup cancels
  everything, and re-running it just recreates the same seeded exposure.
