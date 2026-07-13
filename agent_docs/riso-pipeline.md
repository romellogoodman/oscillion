# Riso Pipeline

The point of this app is physical risograph prints. Everything on screen is
an emissive preview of a print that will blend subtractively — bright
overlap on screen becomes dense dark ink on paper. The exported masters are
the ground truth.

## URL recipes

`#<seedhex>[/<ink>,<ink>...]` — e.g. `#5072741c/25,11`.

- Seed: 32-bit hex, drives the figure via seeded rng. Same seed = same
  figure forever, under any ink set.
- Ink part: indices into `RISO_INKS` (src/App.jsx:68), **in drum order**.
  Order is meaningful — it is both the time order on the filter wheel and
  the print-run order.
- Parse/build: `parseHash` / `buildHash` (src/App.jsx:142, 138). Selecting
  inks recolors the current seed (regenerates with the same figure); it
  never mints a new seed.

## Print masters ("E" / print masters button)

`exportPrintMasters` (in `App`) re-develops the current recipe offline at
`VIEW_SIZE × PRINT_SCALE` = 2400px (≈ 8" at 300 dpi) with 4× the beam
samples, then downloads:

1. `<base>-print.png` — full-color composite, for reference/proofing.
2. One greyscale master per separation layer, dark ink on white
   (`writeMaster`, src/App.jsx:495 — density inverted because the riso
   reads master darkness as ink coverage).

Separation logic:

- **Classic palettes** (no inks selected): 3 layers split by time thirds.
- **Ink mode**: one layer per selected ink, weight-accurate — during
  filter-wheel crossfades a sample splats into both adjacent ink bands with
  weights summing to 1 (`wheel`, src/App.jsx:357). Files carry the ink name:
  `...-master-1-fluor-pink.png`.
- All layers share one auto-exposure (`percentileBands`, src/App.jsx:468) so
  relative density across drums survives; never expose layers independently.

## Ink data

- `RISO_INKS` (src/App.jsx:68): the Risolve color wheel, 34 named inks.
  Copied from `~/code/onyx/scripts/risograph.ts` — onyx is canonical;
  update there first.
- `RISO_COMBOS` (src/App.jsx:116): print-proven 2-ink pairs (May 2024
  Risolve stock, same source). The "combo" button samples these.
- `hexToFilter` (src/App.jsx:107) lifts reflective ink hexes toward emission
  for the screen (normalize max channel to 1, clamp ×2.5 so dark inks like
  Black stay visibly dim rather than turning white).

## At the print shop

Decisions from the original design discussion, so they don't get relitigated:

- Fluorescent inks (Fluor Pink, Light Teal, etc.) on the darkest uncoated
  stock available approximate the emissive look best; deep navy/charcoal
  stock reads as fading phosphor.
- Run registration **loose**. Drum misregistration across the edition is a
  feature — each print becomes its own "setting of the knobs," true to
  Laposky's non-repeatability. Don't try to engineer it away.
- Masters are nominally 72 dpi PNGs (canvas has no DPI metadata); tell the
  shop the intended size — 2400px ≈ 8" at 300 dpi — or resize on import.
