/*
  Oscillon CLI renderer — drive the exposure engine headlessly.

  Runs on Node >= 22.6 (native TypeScript type-stripping; no build step).

    npm run render -- --seed ce14a048 --inks fluor-pink,light-teal
    npm run render -- --random --character silk --figure am --size 1600
    npm run render -- --seed 0cb09815 --aspect 4:5 --size 2000 --view phosphor
    npm run render -- --seed 0cb09815 --inks 25,11 --masters --out prints/

  Outputs PNG (encoded here with node:zlib — no native canvas deps).
  The same seeded engine as the app: a seed always renders the same
  figure at any size, in any view, under any inks.
*/

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { deflateSync } from "node:zlib";

import {
  PRINT_SIZE,
  RISO_INKS,
  createExposure,
  describe,
  fileBase,
  hexToReflect,
  inkSlug,
  makeParams,
  mulberry32,
  parseSeedHex,
  percentileBands,
  pickDistinctSeeds,
  pickSeed,
  samplesForSize,
  seedHex,
  type CharacterFilter,
  type FigureFilter,
  type RisoInk,
} from "../src/engine/oscillon-engine.ts";
import {
  letterbox,
  masterSquare,
  paperSquare,
  phosphorSquare,
  type RGBA,
} from "../src/engine/oscillon-raster.ts";

// ------------------------------------------------------------ png encoder

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(
    [...type].map((ch) => ch.charCodeAt(0)),
    4
  );
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(
  rgba: RGBA,
  width: number,
  height: number,
  level: number = 6,
): Buffer {
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // filter type 0 per scanline
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = y * (width * 4 + 1);
    raw[dst] = 0;
    raw.set(rgba.subarray(src, src + width * 4), dst + 1);
  }
  const idat = deflateSync(raw, { level });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array(idat)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

// ------------------------------------------------------------------- args

const HELP = `oscillon-render — render Oscillon exposures headlessly

  --seed <hex>          recipe seed (8 hex chars); same seed = same figure
  --random              pick a fresh seed instead (honors filters below)
  --character <c>       any | ghost | silk | dense       (with --random)
  --figure <f>          any | am | liss | sweep | spiral (with --random)
  --inks <list>         drum inks, comma-separated names or indices
                        e.g. "fluor-pink,light-teal" or "25,11"
  --view <v>            paper (default) | phosphor
  --background <hex>    paper / backdrop color (default #faf8f3)
  --no-background       transparent letterbox around the piece
  --size <px>           long edge of the output (default 1200)
  --aspect <w:h>        canvas aspect ratio (default 1:1)
  --width/--height <px> explicit output dimensions (override size/aspect)
  --develop-size <px>   square develop resolution (default: min(short
                        edge, 2880) — the figure upscales beyond this)
  --masters             also write the print set: per-drum masters +
                        paper proof + phosphor composite at 2400px
  --grid <CxR>          contact sheet: C columns x R rows of seeds laid
                        out on the page (e.g. --grid 4x6 --aspect 8.5:11)
  --seeds <list>        comma-separated hex seeds for grid cells; missing
                        cells are filled with random picks (honors
                        --character/--figure)
  --video <path>        render the develop bloom as an animation and
                        stitch with ffmpeg; format from the extension
                        (.mp4 | .webm | .gif). Single exposures only.
  --duration <sec>      bloom length in the video (default 8)
  --fps <n>             video frame rate (default 30; gif default 15)
  --hold <sec>          freeze on the finished piece (default 1)
  --out <path>          output file, or directory (trailing /)
  --quiet               no progress output
  --help                this text
`;

const { values: args } = parseArgs({
  options: {
    aspect: { type: "string" },
    background: { type: "string" },
    character: { type: "string" },
    "develop-size": { type: "string" },
    duration: { type: "string" },
    fps: { type: "string" },
    hold: { type: "string" },
    figure: { type: "string" },
    grid: { type: "string" },
    height: { type: "string" },
    help: { type: "boolean" },
    inks: { type: "string" },
    masters: { type: "boolean" },
    "no-background": { type: "boolean" },
    out: { type: "string" },
    quiet: { type: "boolean" },
    random: { type: "boolean" },
    seed: { type: "string" },
    seeds: { type: "string" },
    size: { type: "string" },
    video: { type: "string" },
    view: { type: "string" },
    width: { type: "string" },
  },
});

function fail(message: string): never {
  process.stderr.write(`oscillon-render: ${message}\n`);
  process.exit(1);
}

if (args.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

function parseInks(text: string | undefined): RisoInk[] {
  if (!text) return [];
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const byIndex = /^\d+$/.test(part) ? RISO_INKS[Number(part)] : undefined;
      const bySlug = RISO_INKS.find(
        (ink) => inkSlug(ink.name) === part.toLowerCase()
      );
      const ink = byIndex ?? bySlug;
      if (!ink)
        fail(
          `unknown ink "${part}" (use an index 0-33 or a slug like fluor-pink)`
        );
      return ink;
    })
    .slice(0, 4);
}

function parseAspect(text: string | undefined): number {
  if (!text) return 1;
  const m = /^(\d+(?:\.\d+)?)[:x](\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!m) fail(`invalid --aspect "${text}" (use e.g. 4:5 or 16:9)`);
  return Number(m[1]) / Number(m[2]);
}

function parseGrid(
  text: string | undefined
): { cols: number; rows: number } | null {
  if (!text) return null;
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(text.trim());
  if (!m) fail(`invalid --grid "${text}" (use e.g. 4x4 or 4x6)`);
  const cols = Number(m[1]);
  const rows = Number(m[2]);
  if (cols < 1 || rows < 1 || cols * rows > 64) {
    fail("grid must be between 1x1 and 64 total cells");
  }
  return { cols, rows };
}

// ------------------------------------------------------------------ main

const inks = parseInks(args.inks);
const grid = parseGrid(args.grid);

const character = (args.character ?? "any") as CharacterFilter;
const figure = (args.figure ?? "any") as FigureFilter;

function gatherSeeds(count: number): number[] {
  const listed = (args.seeds ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const parsed = parseSeedHex(part);
      if (parsed === null) fail(`invalid seed "${part}" in --seeds`);
      return parsed;
    });
  if (args.seed) {
    const parsed = parseSeedHex(args.seed);
    if (parsed === null) fail(`invalid --seed "${args.seed}" (8 hex chars)`);
    listed.unshift(parsed);
  }
  if (listed.length < count) {
    listed.push(...pickDistinctSeeds(count - listed.length, character, figure));
  }
  return listed.slice(0, count);
}

let seed = 0;
if (!grid) {
  if (args.seed) {
    const parsed = parseSeedHex(args.seed);
    if (parsed === null) fail(`invalid --seed "${args.seed}" (8 hex chars)`);
    seed = parsed;
  } else if (args.random) {
    seed = pickSeed(character, figure);
  } else {
    fail("pass --seed <hex>, --random, or --grid (see --help)");
  }
}

const size = args.size ? Number(args.size) : 1200;
if (!Number.isFinite(size) || size < 64 || size > 16384) {
  fail(`invalid --size ${args.size}`);
}
const aspect = parseAspect(args.aspect);
let width = aspect >= 1 ? Math.round(size) : Math.round(size * aspect);
let height = aspect >= 1 ? Math.round(size / aspect) : Math.round(size);
if (args.width) width = Number(args.width);
if (args.height) height = Number(args.height);
if (
  ![width, height].every((v) => Number.isFinite(v) && v >= 64 && v <= 16384)
) {
  fail("invalid output dimensions");
}

const shortEdge = Math.min(width, height);
const developSize = args["develop-size"]
  ? Number(args["develop-size"])
  : Math.min(shortEdge, 2880);
if (!Number.isFinite(developSize) || developSize < 64 || developSize > 8192) {
  fail(`invalid --develop-size ${args["develop-size"]}`);
}

const view = args.view === "phosphor" ? "phosphor" : "paper";
const backgroundHex = args.background ?? "#faf8f3";
if (!/^#[0-9a-f]{6}$/i.test(backgroundHex)) {
  fail(`invalid --background "${backgroundHex}"`);
}
const includeBackground = !args["no-background"];

const log = (line: string) => {
  if (!args.quiet) process.stderr.write(line);
};

function resolveOut(defaultName: string): string {
  if (!args.out) return resolve(defaultName);
  const wantsDir = args.out.endsWith("/") || args.out.endsWith("\\");
  const path = wantsDir ? join(args.out, defaultName) : args.out;
  mkdirSync(dirname(resolve(path)), { recursive: true });
  return resolve(path);
}

if (grid) {
  if (args.masters) fail("--masters applies to single pieces, not grids");
  const count = grid.cols * grid.rows;
  const seeds = gatherSeeds(count);
  const short = Math.min(width, height);
  const margin = Math.round(short * 0.05);
  const gap = Math.round(short * 0.012);
  const cellSide = Math.floor(
    Math.min(
      (width - margin * 2 - gap * (grid.cols - 1)) / grid.cols,
      (height - margin * 2 - gap * (grid.rows - 1)) / grid.rows
    )
  );
  if (cellSide < 64)
    fail("grid cells would be smaller than 64px; raise --size");
  const blockW = grid.cols * cellSide + (grid.cols - 1) * gap;
  const blockH = grid.rows * cellSide + (grid.rows - 1) * gap;
  const originX = Math.floor((width - blockW) / 2);
  const originY = Math.floor((height - blockH) / 2);
  const cellDevelop = Math.min(cellSide, 1200);

  const page = new Uint8ClampedArray(width * height * 4);
  const bg = includeBackground
    ? view === "paper"
      ? hexToReflect(backgroundHex)
      : ([0, 0, 0] as [number, number, number])
    : null;
  if (bg) {
    const r = Math.round(bg[0] * 255);
    const g = Math.round(bg[1] * 255);
    const b = Math.round(bg[2] * 255);
    for (let i = 0; i < page.length; i += 4) {
      page[i] = r;
      page[i + 1] = g;
      page[i + 2] = b;
      page[i + 3] = 255;
    }
  }

  const hashSeeds = seeds.map(seedHex).join(",");
  const inkPart = inks.length
    ? `/${inks.map((ink) => RISO_INKS.indexOf(ink)).join(",")}`
    : "";
  log(
    `contact sheet ${grid.cols}x${grid.rows} · view ${view} · ${width}x${height}\n`
  );
  log(`recipe #${hashSeeds}${inkPart}\n`);

  for (let i = 0; i < count; i++) {
    const cellSeed = seeds[i];
    const cellExp = createExposure(
      cellSeed,
      cellDevelop,
      samplesForSize(cellDevelop),
      inks
    );
    while (!cellExp.develop(400_000)) {
      log(
        `\rcell ${i + 1}/${count} … ${Math.round((cellExp.done / cellExp.total) * 100)}%`
      );
    }
    const cellInfo = describe(cellExp.P, cellSeed);
    const col = i % grid.cols;
    const row = (i / grid.cols) | 0;
    log(
      `\rcell ${i + 1}/${count} r${row + 1}c${col + 1} · ${cellInfo.seed} · No. ${cellInfo.no} · ${cellInfo.settings}\n`
    );
    const squareCell =
      view === "paper"
        ? paperSquare(cellExp, backgroundHex)
        : phosphorSquare(cellExp);
    const scaled = letterbox(squareCell, cellExp.S, cellSide, cellSide, bg);
    const dx = originX + col * (cellSide + gap);
    const dy = originY + row * (cellSide + gap);
    for (let y = 0; y < cellSide; y++) {
      const src = y * cellSide * 4;
      const dst = ((dy + y) * width + dx) * 4;
      page.set(scaled.subarray(src, src + cellSide * 4), dst);
    }
  }

  const sheetPath = resolveOut(
    `oscillon-sheet-${grid.cols}x${grid.rows}-${seedHex(seeds[0])}.png`
  );
  writeFileSync(sheetPath, encodePng(page, width, height));
  log(`wrote ${sheetPath}\n`);
  process.exit(0);
}

const P = makeParams(mulberry32(seed));
const info = describe(P, seed);
const recipeHash = `#${seedHex(seed)}${
  inks.length ? `/${inks.map((ink) => RISO_INKS.indexOf(ink)).join(",")}` : ""
}`;

log(`Oscillon No. ${info.no} · seed ${info.seed}\n`);
log(`${info.settings}\n`);
log(
  `recipe ${recipeHash} · view ${view} · ${width}x${height} (develop ${developSize})\n`
);

function developFully(atSize: number) {
  const exp = createExposure(seed, atSize, samplesForSize(atSize), inks);
  let lastTenth = -1;
  while (!exp.develop(200_000)) {
    const tenth = Math.floor((exp.done / exp.total) * 10);
    if (tenth !== lastTenth) {
      lastTenth = tenth;
      log(`\rdeveloping ${atSize}px … ${tenth * 10}%`);
    }
  }
  log(`\rdeveloping ${atSize}px … done\n`);
  return exp;
}

const base = fileBase(P, seed);

if (args.video) {
  if (grid) fail("--video renders single exposures; drop --grid");
  if (args.masters) fail("--video and --masters are separate runs");
  const format = extname(args.video).slice(1).toLowerCase();
  if (!["mp4", "webm", "gif"].includes(format)) {
    fail(`--video needs a .mp4, .webm, or .gif path (got "${args.video}")`);
  }
  const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
    fail("ffmpeg not found — install it (e.g. `brew install ffmpeg`)");
  }

  const fps = args.fps ? Number(args.fps) : format === "gif" ? 15 : 30;
  const duration = args.duration ? Number(args.duration) : 8;
  const hold = args.hold ? Number(args.hold) : 1;
  if (!(fps >= 1 && fps <= 60)) fail(`invalid --fps ${args.fps}`);
  if (!(duration > 0 && duration <= 120)) {
    fail(`invalid --duration ${args.duration}`);
  }
  // yuv420p needs even dimensions
  width -= width % 2;
  height -= height % 2;

  const exp = createExposure(seed, developSize, samplesForSize(developSize), inks);
  const frameCount = Math.max(1, Math.round(fps * duration));
  const perFrame = Math.ceil(exp.total / frameCount);
  const bg = includeBackground
    ? view === "paper"
      ? hexToReflect(backgroundHex)
      : ([0, 0, 0] as [number, number, number])
    : null;

  const framesDir = mkdtempSync(join(tmpdir(), "oscillon-frames-"));
  try {
    for (let f = 0; f < frameCount; f++) {
      exp.develop(perFrame);
      const square =
        view === "paper" ? paperSquare(exp, backgroundHex) : phosphorSquare(exp);
      const composed = letterbox(square, exp.S, width, height, bg);
      writeFileSync(
        join(framesDir, `frame-${String(f).padStart(5, "0")}.png`),
        encodePng(composed, width, height, 1),
      );
      log(`\rframe ${f + 1}/${frameCount}`);
    }
    // freeze on the finished piece
    const holdFrames = Math.round(hold * fps);
    const lastFrame = readFileSync(
      join(framesDir, `frame-${String(frameCount - 1).padStart(5, "0")}.png`),
    );
    for (let f = 0; f < holdFrames; f++) {
      writeFileSync(
        join(framesDir, `frame-${String(frameCount + f).padStart(5, "0")}.png`),
        lastFrame,
      );
    }
    log(`\nencoding ${format} …\n`);

    mkdirSync(dirname(resolve(args.video)), { recursive: true });
    const input = join(framesDir, "frame-%05d.png");
    const ffArgs =
      format === "gif"
        ? [
            "-framerate", String(fps), "-i", input,
            "-filter_complex",
            `fps=${fps},split [a][b];[a] palettegen [p];[b][p] paletteuse`,
            "-y", resolve(args.video),
          ]
        : format === "webm"
          ? [
              "-framerate", String(fps), "-i", input,
              "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32",
              "-pix_fmt", "yuv420p", "-y", resolve(args.video),
            ]
          : [
              "-framerate", String(fps), "-i", input,
              "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
              "-preset", "medium", "-movflags", "+faststart",
              "-y", resolve(args.video),
            ];
    const encode = spawnSync("ffmpeg", ffArgs, { encoding: "utf8" });
    if (encode.status !== 0) {
      process.stderr.write(encode.stderr ?? "");
      fail("ffmpeg encoding failed");
    }
    log(`wrote ${resolve(args.video)}\n`);
  } finally {
    rmSync(framesDir, { force: true, recursive: true });
  }
  process.exit(0);
}

const exp = developFully(developSize);

const square =
  view === "paper" ? paperSquare(exp, backgroundHex) : phosphorSquare(exp);
const background = includeBackground
  ? view === "paper"
    ? hexToReflect(backgroundHex)
    : ([0, 0, 0] as [number, number, number])
  : null;
const composed = letterbox(square, exp.S, width, height, background);
const outPath = resolveOut(
  `${base}${view === "phosphor" ? "-phosphor" : ""}.png`
);
writeFileSync(outPath, encodePng(composed, width, height));
log(`wrote ${outPath}\n`);

if (args.masters) {
  const printExp = developSize === PRINT_SIZE ? exp : developFully(PRINT_SIZE);
  const S = printExp.S;
  const dir =
    args.out && (args.out.endsWith("/") || args.out.endsWith("\\"))
      ? args.out
      : dirname(outPath) + "/";

  const compositePath = resolveOut(join(dir, `${base}-print.png`));
  writeFileSync(compositePath, encodePng(phosphorSquare(printExp), S, S));
  log(`wrote ${compositePath}\n`);

  const K = percentileBands(printExp.bands, S, 2.8);
  for (let i = 0; i < printExp.bands.length; i++) {
    const layer = printExp.P.inks
      ? `master-${i + 1}-${inkSlug(printExp.P.inks[i].name)}`
      : `master-${i + 1}`;
    const path = resolveOut(join(dir, `${base}-${layer}.png`));
    writeFileSync(path, encodePng(masterSquare(printExp, i, K), S, S));
    log(`wrote ${path}\n`);
  }

  const proofPath = resolveOut(join(dir, `${base}-proof.png`));
  writeFileSync(
    proofPath,
    encodePng(paperSquare(printExp, backgroundHex), S, S)
  );
  log(`wrote ${proofPath}\n`);
}
