# Oscillon

Simulated oscilloscope exposures after Ben Laposky's _Oscillons_ — a
beam driven by modulated sine waves deposits light into an accumulation
buffer, developed with long-exposure film response. Front end of a
risograph print pipeline.

**Live demo:** <https://oscillion.romellogoodman.com>

## The demo

```bash
npm install
npm run dev   # http://localhost:8080
```

One exposure at a time, blooming over ~12 seconds on a black phosphor
screen. **Click** for a new piece — the ink pairing rotates by itself
through print-proven Risolve combos. The caption shows the piece's
seed; the URL hash (`#seed[/inks]`) is the full recipe and reproduces
the piece exactly, here or in the CLI. Quiet extras: `N`/space new
exposure, `S` save png, `P` paper/black background, `G` contact-sheet
grid (double-click a cell to develop it).

## The CLI

```bash
npm run render -- --seed 0cb09815 --inks fluor-pink,light-teal
npm run render -- --random --character silk --view phosphor --size 1600
npm run render -- --seed 0cb09815 --inks 25,11 --masters --out prints/
npm run render -- --grid 4x6 --aspect 8.5:11 --size 2550 --out sheets/
npm run render -- --seed 0cb09815 --inks 25,11 --video bloom.mp4
```

`--video` renders the develop bloom itself as an animation (format from
the extension: `.mp4`, `.webm`, or `.gif`; needs ffmpeg on PATH) with
`--duration`, `--fps`, and a `--hold` freeze on the finished piece.

Same engine, headless (Node >= 22.6, no browser, no native deps).
`--help` lists everything. The CLI defaults to the **paper** view
(white, print-proofed inks) — pass `--view phosphor` for the demo's
black-screen look. Grid mode prints each cell's seed and settings so
any piece on a contact sheet can be re-rendered exactly.

## Deploying

The demo deploys to Vercel (project `oscillion`, serving
[oscillion.romellogoodman.com](https://oscillion.romellogoodman.com)):

```bash
vercel deploy --prod
```

## Docs

- [CLAUDE.md](CLAUDE.md) — layout, invariants
- [agent_docs/rendering-engine.md](agent_docs/rendering-engine.md) — how
  an exposure is made
- [agent_docs/riso-pipeline.md](agent_docs/riso-pipeline.md) — seeds,
  masters, inks, printing
