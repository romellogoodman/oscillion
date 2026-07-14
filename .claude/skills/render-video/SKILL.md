---
name: render-video
description: Render Oscillon exposures as bloom videos (mp4/webm/gif) via the CLI — single pieces or social-media batches with per-seed ink combos.
---

# Rendering Oscillon Videos

`--video` renders one exposure's develop bloom frame-by-frame and
stitches it with ffmpeg (must be on PATH). Format comes from the
extension: `.mp4` (libx264, yuv420p, faststart), `.webm` (vp9), or
`.gif` (palettegen/paletteuse, 15fps default).

## The command

```bash
npm run render -- --seed <hex> --inks <names-or-indices> --view phosphor \
  --aspect 16:9 --size 1920 --duration 10 --video ~/Desktop/<out>.mp4
```

- **Always pass `--view phosphor` for the black-background look** — the
  CLI defaults to the paper (white) view, even with inks.
- Render to `~/Desktop` unless the user asks for another destination.
- `--duration` seconds of bloom (default 8), `--hold` seconds frozen on
  the finished piece (default 1), `--fps` (default 30; gif 15).
- Dimensions are forced even for yuv420p; the square figure letterboxes
  centered on black at any `--aspect`.
- `--video` is single-piece only (no `--grid`, no `--masters`).

## Social-media presets

- 16:9 (X/YouTube): `--aspect 16:9 --size 1920` → 1920×1080
- 9:16 (Reels/TikTok): `--aspect 9:16 --size 1920` → 1080×1920
- 1:1 (feed): `--size 1080`

## Resolving inks for a picked piece

Every piece is fully described by its recipe `#seed/inkIdx,inkIdx`.
When picks come from a curation folder (wherever the user keeps it —
ask or look for a folder holding contact sheets and a `pairs.txt`),
the seed→inks mapping lives in its `pairs.txt` (`<seed> <i>,<i>` per
line) or in the sheet log's `recipe #...` lines. Ink indices point into
`RISO_INKS` (src/engine/oscillon-engine.ts); names work too, slugified
(`fluor-pink,light-teal`).

## Batching

Name outputs `oscillon-<pieceNo>-<seed>.mp4` (the piece number is
printed by the CLI and appears in single-render PNG filenames). Run ~3
in parallel; each render is a single node process plus a short ffmpeg
encode:

```bash
xargs -P 3 -L 1 ./render-one.sh < jobs.txt   # jobs.txt: "piece seed inks" per line
```

Two shell traps, learned the hard way:

- zsh does **not** word-split unquoted `${var//,/ }` — build explicit
  job lists (awk/xargs) instead of relying on splitting.
- Redirect node's stdin (`</dev/null`) inside `while read` loops or the
  CLI will eat the remaining lines of the job list.

## Verify

```bash
ffprobe -v error -select_streams v \
  -show_entries stream=width,height,pix_fmt,duration -of csv=p=0 out.mp4
```

Expect the requested dimensions, `yuv420p`, and duration + hold. To
eyeball colors, extract a late frame:
`ffmpeg -sseof -1.2 -i out.mp4 -frames:v 1 frame.png`.
