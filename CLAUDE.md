# Oscillon

Simulated oscilloscope exposures after Ben Laposky's Oscillons: a beam driven
by modulated sine pairs deposits light into accumulation buffers, developed
with long-exposure film response and a time→hue filter wheel. The screen app
is a front end — the end product is **risograph prints**, and the export path
(seeds, separations, masters) is what ultimately matters.

## Stack & Structure

- React 19 + Vite + SCSS. No other runtime dependencies.
- Rendering is plain Canvas2D on Float32 buffers — no p5.js or graphics
  libraries. Don't add any.
- Single-file layout, intentional for prototyping: all components live in
  `src/App.jsx`, all styles in `src/App.scss`. Refactor into multiple files
  only when asked.

## Commands

- `npm run dev` — dev server at http://localhost:8080 (opens a browser)
- `npm run lint` / `npm run lint:fix` — ESLint
- `npm run format` — Prettier (run it after editing; CI-less repo, no excuses)
- `npm run build` — production build

There are no tests. Verification = lint + build + loading the app and
confirming an exposure develops (and reproduces from its URL hash).

## Invariants

- **Determinism.** A URL hash (`#seed/inks`) must always reproduce the
  identical figure. All figure randomness flows from the seeded rng in
  `createExposure` (src/App.jsx:289) — never `Math.random()`. Film grain
  (`g3`, src/App.jsx:48) is the only sanctioned exception. When adding
  parameters, append new `rng()` draws after the existing ones in
  `makeParams` so old seeds keep their figures.
- **Masters are ground truth.** The screen is an emissive preview; prints
  blend subtractively. Engine changes must keep the separation bands
  weight-accurate (every beam sample's band weights sum to 1).
- **Ink data mirrors onyx.** The riso ink list and combos come from
  `~/code/onyx/scripts/risograph.ts` — update there first, then copy here.

## Conventions

- BEM class naming (`.block__element--modifier`) with SCSS `&` nesting;
  theming via CSS custom properties defined at the top of `src/App.scss`.

## Topic docs — read the relevant one before working in that area

- `agent_docs/rendering-engine.md` — beam math, buffers, tone mapping,
  exposure parameters, performance
- `agent_docs/riso-pipeline.md` — URL recipes, print masters, separations,
  ink data, print-shop guidance
