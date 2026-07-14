# Riso Pipeline

The point of this app is physical risograph prints. Everything on screen is
an emissive preview of a print that will blend subtractively — bright
overlap on screen becomes dense dark ink on paper. The exported masters are
the ground truth.

## URL recipes

`#<seed>[,<seed>...][/<ink>,<ink>...]` — e.g. `#5072741c/25,11`; 4 or 16
seeds restore a contact sheet.

- Seed: 32-bit hex, drives the figure via seeded rng. Same seed = same
  figure forever, under any ink set.
- Ink part: indices into `RISO_INKS` (src/engine/oscillon-engine.ts), **in drum order**.
  Order is meaningful — it is both the time order on the filter wheel and
  the print-run order.
- Parse/build: `parseHash` / `buildHash` (src/App.jsx). The demo writes
  the hash on every new piece and reads it once on load, so any recipe
  reproduces exactly. There is no ink picker in the demo — combos
  auto-rotate on click; to pin a specific ink set, edit the hash's ink
  part or use the CLI's `--inks`.

## Print masters (CLI `--masters`)

`--masters` (scripts/oscillon-render.ts; single pieces only — not grids
or video) re-develops the recipe offline at `PRINT_SIZE` = 2400px
(≈ 8" at 300 dpi, ~4× the view's beam samples), then writes:

1. `<base>-print.png` — full-color emissive composite, for reference.
2. One greyscale master per separation layer, dark ink on white
   (`writeMaster`, src/engine/oscillon-engine.ts — density inverted because the riso
   reads master darkness as ink coverage).
3. `<base>-proof.png` — the paper proof (below) at print size; give this
   to the print shop as the color reference for white stock.

Separation logic:

- **Classic palettes** (no inks selected): 3 layers split by time thirds.
- **Ink mode**: one layer per selected ink, weight-accurate — during
  filter-wheel crossfades a sample splats into both adjacent ink bands with
  weights summing to 1 (`wheel`, src/engine/oscillon-engine.ts). Files carry the ink name:
  `...-master-1-fluor-pink.png`.
- All layers share one auto-exposure (`percentileBands`, src/engine/oscillon-engine.ts) so
  relative density across drums survives; never expose layers independently.

## Paper view — printing on white paper

The phosphor view is emissive (light adds toward white); a riso print on
white paper is subtractive (ink multiplies toward dark). The paper
view (`writeProof`, src/engine/oscillon-engine.ts) shows the print: each separation band's
coverage (same film curve, ~90% max) tints the paper with the ink's
**reflective** hex, layers multiply, and each drum gets a small
deterministic misregistration offset derived from the seed. No inks
selected → all bands proof in riso Black. In the demo, `P` (or the `bg`
button) toggles paper/black; in the CLI, `--view paper|phosphor` —
**paper is the CLI default**, while the demo defaults to black phosphor.

Masters are positive (ink = trace) and are already correct for white
stock. The unbuilt alternative for an emissive look on white paper is a
knockout print — flood a dark ink field and let the figure stay unprinted
paper — which is one inverted `writeMaster` away if ever wanted; note riso
struggles with large flat fields (banding/roller marks).

## Ink data

- `RISO_INKS` (src/engine/oscillon-engine.ts): the Risolve color wheel, 34 named inks.
  Copied from `~/code/onyx/scripts/risograph.ts` — onyx is canonical;
  update there first.
- `RISO_COMBOS` (src/engine/oscillon-engine.ts): print-proven 2-ink pairs (May 2024
  Risolve stock, same source). The demo auto-rotates through these on
  each click; `randomInkCombo` samples them.
- `hexToFilter` (src/engine/oscillon-engine.ts) lifts reflective ink hexes toward emission
  for the screen (normalize max channel to 1, clamp ×2.5 so dark inks like
  Black stay visibly dim rather than turning white).

## At the print shop

Decisions from the design discussions, so they don't get relitigated:

- **The plan is white paper** (decided 2026-07-13): positive masters, soft
  ghost/silk exposures whose mid-grey veils become delicate ink washes.
  Avoid dense blown-out seeds for white stock — hot cores become solid ink
  slabs.
- Dark-stock alternative (earlier idea, still valid): fluorescent inks on
  the darkest uncoated stock approximate the emissive look.
- Run registration **loose**. Drum misregistration across the edition is a
  feature — each print becomes its own "setting of the knobs," true to
  Laposky's non-repeatability. Don't try to engineer it away.
- Masters are nominally 72 dpi PNGs (canvas has no DPI metadata); tell the
  shop the intended size — 2400px ≈ 8" at 300 dpi — or resize on import.
