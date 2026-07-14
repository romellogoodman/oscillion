# Oscillon

Simulated oscilloscope exposures after Ben Laposky's Oscillons: a beam
driven by modulated sine pairs deposits light into accumulation buffers,
developed with film response and a time→hue filter wheel. The app is a
personal design tool; the end product is **risograph prints on white
paper**, and the export path (seeds, per-drum separations, masters,
proofs) is what ultimately matters.

## Monorepo layout (npm workspaces)

- `apps/tool` — the Toolcraft design tool **and** the headless CLI
  (`scripts/oscillon-render.ts`); they share one engine
  (`apps/tool/src/app/oscillon-engine.ts`). **`apps/tool/AGENTS.md` is the active
  contract for that subtree** — read it (and `docs/toolcraft/*` there)
  before touching app code, controls, the renderer, exports, or tests.
  Never hand-compose runtime surfaces; `src/toolcraft/` is the copied
  runtime, do not patch it per-app.
- `apps/site` — the original single-exposure website (click for a new
  piece), intentionally standalone and self-contained; it keeps its own
  frozen engine copy in `src/App.jsx` and is NOT kept in seed-parity
  with the tool.

Root scripts proxy the tool: `npm run dev` (tool, port 3002),
`npm run dev:site` (site, port 8080), `npm run render -- …` (CLI),
`npm run test` / `verify:quick` / `verify:final` / `test:browser`.

## Oscillon invariants (on top of the Toolcraft contract)

- **Determinism.** A recipe hash (`#seed[,seed...][/inks]`) must always
  reproduce the identical figure(s). All figure randomness flows from
  the seeded rng in `apps/tool/src/app/oscillon-engine.ts` — never
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
- `apps/tool/docs/oscillon-renderer-spec.md` — renderer technique matrix
  and pipeline inventory (mirrored in `apps/tool/src/app/app-performance.ts`)
