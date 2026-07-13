# Oscillon

Simulated oscilloscope exposures after Ben Laposky's Oscillons: a beam
driven by modulated sine pairs deposits light into accumulation buffers,
developed with film response and a time→hue filter wheel. The app is a
personal design tool; the end product is **risograph prints on white
paper**, and the export path (seeds, per-drum separations, masters,
proofs) is what ultimately matters.

## This is a Toolcraft app

The repo is a generated Toolcraft app. **AGENTS.md is the active project
contract** — read it (and the docs it routes to under `docs/toolcraft/`)
before touching app code, controls, the renderer, exports, or tests.
Build through `defineToolcraft` / `ToolcraftApp`; never hand-compose
runtime surfaces. Edit surface: `src/app/*` and `src/routes/*` only —
`src/toolcraft/` is the copied runtime, do not patch it per-app.

- `npm run dev` — dev server (prefers port 3002)
- `npm run verify:quick` — ai:check + validator/unit suite
- `npm run test:browser` — Playwright acceptance (excludes perf)
- `npm run verify:final` — full delivery gate

## Oscillon invariants (on top of the Toolcraft contract)

- **Determinism.** A recipe hash (`#seed[,seed...][/inks]`) must always
  reproduce the identical figure(s). All figure randomness flows from
  the seeded rng in `src/app/oscillon-engine.ts` — never
  `Math.random()`. Film grain (`g3`) is the only sanctioned exception.
  When adding parameters, append new `rng()` draws after the existing
  ones in `makeParams` so old seeds keep their figures.
- **Masters are ground truth.** The paper view is a preview; the 2400px
  print masters (one grey per drum, shared auto-exposure) never resample
  the preview and must stay pixel-exact. Band weights per beam sample
  always sum to 1.
- **Ink data mirrors onyx.** The Risolve ink wheel and proven combos
  come from `~/code/onyx/scripts/risograph.ts` — update there first.

## Topic docs

- `agent_docs/rendering-engine.md` — beam math, exposure characters,
  tone mapping, performance shape
- `agent_docs/riso-pipeline.md` — recipes, masters, inks, print-shop
  guidance (white paper)
- `docs/oscillon-renderer-spec.md` — renderer technique matrix and
  pipeline inventory (mirrored in `src/app/app-performance.ts`)
