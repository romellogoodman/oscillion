# Oscillon

Simulated oscilloscope exposures after Ben Laposky's _Oscillons_ — a beam
driven by modulated sine waves deposits light into an accumulation buffer,
developed with long-exposure film response. Built as the generation and
separation front end for risograph prints.

Built as a [Toolcraft](https://pixelpoint.io/blog/how-to-craft-personal-design-tools-with-toolcraft/)
app: React 19 + Vite + TypeScript with the Toolcraft runtime shell, and a
custom Canvas 2D accumulation renderer.

## Quick Start

```bash
npm install
npm run dev   # prefers http://127.0.0.1:3002
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

## Docs

- [CLAUDE.md](CLAUDE.md) — project conventions and invariants
- [agent_docs/rendering-engine.md](agent_docs/rendering-engine.md) — how an
  exposure is made
- [agent_docs/riso-pipeline.md](agent_docs/riso-pipeline.md) — seeds, masters,
  inks, and printing
