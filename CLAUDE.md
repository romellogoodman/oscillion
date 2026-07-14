# Oscillon

Simulated oscilloscope exposures after Ben Laposky's Oscillons: a beam
driven by modulated sine pairs deposits light into accumulation buffers,
developed with film response and a time→hue filter wheel. The end
product is **risograph prints on white paper**; Romello separates
colors in his own app, so renders (not masters) are the usual output.

## Layout (flat, single package)

- `src/engine/oscillon-engine.ts` — the entire instrument: seeded
  params, beam physics, accumulation, tone mapping, proofs, masters,
  ink data. Pure TypeScript, zero deps, no DOM in hot paths.
- `src/engine/oscillon-raster.ts` — pure RGBA composing (phosphor /
  paper / master squares, letterboxing). Also environment-free.
- `src/App.jsx` + `src/App.scss` — the demo site: one exposure slowly
  blooming (~12s) on black; click = new seed + auto-rotated ink combo.
  No masters or ink UI here by design.
- `scripts/oscillon-render.ts` — the CLI (`npm run render -- --help`):
  seeds/random+filters, inks, views, size/aspect, `--masters`,
  `--grid CxR` contact sheets with per-cell seed logs, and `--video`
  (bloom animation via ffmpeg: mp4/webm/gif by extension).

Commands: `npm run dev` (demo, port 8080) · `npm run render -- …` ·
`lint` / `build` / `format` · `vercel deploy --prod` (demo →
oscillion.romellogoodman.com). Node >= 22.6 (CLI uses native
type-stripping).

## Invariants

- **Determinism.** A recipe hash (`#seed[,seed...][/inks]`) must always
  reproduce the identical figure(s) in the demo AND the CLI. All figure
  randomness flows from the seeded rng in `makeParams`; film grain
  (`g3`) is the only sanctioned exception. New parameters must APPEND
  their `rng()` draws after existing ones — and note that object-literal
  property order IS draw order (a reordered `{k, amp}` literal once
  broke seed parity).
- **Masters are ground truth** for print: per-drum greys share one
  auto-exposure (`percentileBands`); band weights per beam sample sum
  to 1. Only the CLI exports them now.
- **Ink data mirrors onyx.** The Risolve wheel and proven combos come
  from `~/code/onyx/scripts/risograph.ts` — update there first.

## Topic docs

- `agent_docs/rendering-engine.md` — beam math, exposure characters,
  tone mapping, performance shape
- `agent_docs/riso-pipeline.md` — recipes, masters, inks, print-shop
  guidance (white paper)
