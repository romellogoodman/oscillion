# Oscillon

Simulated oscilloscope exposures after Ben Laposky's _Oscillons_ — a beam
driven by modulated sine waves deposits light into an accumulation buffer,
developed with long-exposure film response. Built as the generation and
separation front end for risograph prints.

React 19 + Vite + SCSS, rendering on plain Canvas2D.

## Quick Start

```bash
npm install
npm run dev
```

Then: **click** for a new exposure · **S** save png · **E** export print
masters · **I** pick risograph inks. The URL hash (`#seed/inks`) is the full
recipe — share it or reload it to reproduce a piece exactly.

## Available Scripts

```bash
npm run dev          # Start dev server (port 8080)
npm run build        # Build for production
npm run lint         # Check for errors
npm run lint:fix     # Fix linting errors
npm run format       # Format code with Prettier
npm run preview      # Preview production build
npm run clean        # Remove build artifacts
```

## Environment Variables

Copy `.env.example` to `.env.local` and configure as needed. All variables
must be prefixed with `VITE_`.

## Docs

- [CLAUDE.md](CLAUDE.md) — project conventions and invariants
- [agent_docs/rendering-engine.md](agent_docs/rendering-engine.md) — how an
  exposure is made
- [agent_docs/riso-pipeline.md](agent_docs/riso-pipeline.md) — seeds, masters,
  inks, and printing
