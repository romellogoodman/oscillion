# Oscillon

Simulated oscilloscope exposures after Ben Laposky's _Oscillons_ — a beam
driven by modulated sine waves deposits light into an accumulation buffer,
developed with long-exposure film response. Built as the generation and
separation front end for risograph prints.

A monorepo (npm workspaces):

- **`apps/tool`** — the [Toolcraft](https://pixelpoint.io/blog/how-to-craft-personal-design-tools-with-toolcraft/)
  design tool and the headless CLI renderer, sharing one engine.
- **`apps/site`** — the original standalone site: one exposure at a
  time, click for the next.

## Quick Start

```bash
npm install
npm run dev        # the tool  (prefers http://127.0.0.1:3002)
npm run dev:site   # the site  (http://localhost:8080)
```

Controls live in the panel: Exposure (character/figure filters + seed),
Contact sheet (1 / 2×2 / 4×4 — double-click a cell to develop it), Inks
(Risolve drum picker + Combo/Clear), View (paper/phosphor), Background,
Image Export, and sticky Generate / Export PNG / Print Masters actions.
The URL hash (`#seed[,seed...][/inks]`) is the full recipe — share it or
reload it to reproduce a piece or a whole sheet exactly.

## Available Scripts

```bash
npm run dev            # Dev server (saved port, prefers 3002)
npm run build          # Typecheck + production build
npm run verify:quick   # ai:check + validator/unit suite
npm run test:browser   # Playwright browser acceptance
npm run verify:final   # Full delivery gate
```

## CLI rendering

`npm run render` drives the same engine headlessly (Node >= 22.6, no
browser, no native deps):

```bash
npm run render -- --seed 0cb09815 --inks fluor-pink,light-teal
npm run render -- --random --character silk --view phosphor --size 1600
npm run render -- --seed 0cb09815 --inks 25,11 --masters --out prints/
npm run render -- --grid 4x6 --aspect 8.5:11 --size 2550 --out sheets/
```

`--help` lists everything. Grid mode prints each cell's seed and
settings so any piece on a contact sheet can be re-rendered exactly.

## Docs

- [CLAUDE.md](CLAUDE.md) — project conventions and invariants
- [agent_docs/rendering-engine.md](agent_docs/rendering-engine.md) — how an
  exposure is made
- [agent_docs/riso-pipeline.md](agent_docs/riso-pipeline.md) — seeds, masters,
  inks, and printing
