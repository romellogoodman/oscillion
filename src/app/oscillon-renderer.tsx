import * as React from "react";

import { shouldIncludeToolcraftPreviewBackground } from "@/toolcraft/runtime";
import { useToolcraft } from "@/toolcraft/runtime/react";

import {
  DEVELOP_CHUNK,
  RISO_INKS,
  createExposure,
  drawExposureTile,
  hexToReflect,
  makeMapper,
  parseSeedHex,
  pickSeed,
  samplesForSize,
  seedHex,
  type CharacterFilter,
  type Exposure,
  type FigureFilter,
  type Mapper,
} from "./oscillon-engine";

/*
  Product renderer: hosts the accumulation-buffer develop loop and
  composites the exposure (or contact sheet) into a Canvas 2D element
  sized to the runtime canvas. Render passes:

  1. develop  — beam samples into Float32 buffers (chunked, per rAF)
  2. tone map — film response + auto exposure into ImageData planes
  3. composite — letterboxed blit; paper view multiplies separation
     bands over the paper color, phosphor view adds core + glow over
     black

  Develop is invalidated by (seeds, size, inks); view mode and
  background only recomposite. Canvas drag/zoom never re-enters the
  develop loop — the rAF work is buffer accumulation that coalesces
  naturally and the composite throttles itself.
*/

// develop buffers are capped so a huge canvas cannot allocate
// gigabyte-scale Float32 buffers; the composite upscales beyond this
const MAX_DEVELOP_SIZE = 2400;

export function developSizeFor(
  width: number,
  height: number,
  renderScale: number,
): number {
  return Math.min(
    MAX_DEVELOP_SIZE,
    Math.max(64, Math.round(Math.min(width, height) * renderScale)),
  );
}

export type OscillonRecipe = {
  grid: number;
  inks: readonly number[];
  seeds: readonly number[];
};

type Cell = {
  exp: Exposure;
  mapper: Mapper;
  seed: number;
};

export function readRecipe(values: Record<string, unknown>): OscillonRecipe {
  const grid = Number.parseInt(String(values["sheet.grid"] ?? "1"), 10) || 1;
  const inksRaw = values["inks.drums"];
  const inks = Array.isArray(inksRaw)
    ? inksRaw
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0 && v < RISO_INKS.length)
    : [];
  const seedsSource =
    grid > 1
      ? String(values["sheet.seeds"] ?? "")
      : String(values["exposure.seed"] ?? "");
  const seeds = seedsSource
    .split(",")
    .map((part) => parseSeedHex(part))
    .filter((v): v is number => v !== null)
    .slice(0, grid * grid);
  return { grid, inks, seeds };
}

export function pickSheetSeeds(
  values: Record<string, unknown>,
  count: number,
): number[] {
  const character = String(
    values["exposure.character"] ?? "any",
  ) as CharacterFilter;
  const figure = String(values["exposure.figure"] ?? "any") as FigureFilter;
  return Array.from({ length: count }, () => pickSeed(character, figure));
}

// ------------------------------------------------------- URL recipe hash

// #<seed>[,<seed>...][/<ink>,<ink>...] — one seed is a single exposure,
// 4 or 16 seeds restore a contact sheet
export function buildRecipeHash(recipe: OscillonRecipe): string {
  const seeds = recipe.seeds.map(seedHex).join(",");
  const inks = recipe.inks.length ? `/${recipe.inks.join(",")}` : "";
  return `#${seeds}${inks}`;
}

export function parseRecipeHash(
  hash: string,
): { seeds: number[]; inks: number[] } | null {
  const m = /^#([0-9a-f]{1,8}(?:,[0-9a-f]{1,8})*)(?:\/(\d+(?:,\d+)*))?$/i.exec(
    hash,
  );
  if (!m) return null;
  const seeds = m[1]
    .split(",")
    .map((part) => parseSeedHex(part))
    .filter((v): v is number => v !== null);
  const inks: number[] = [];
  if (m[2]) {
    for (const part of m[2].split(",")) {
      const idx = Number.parseInt(part, 10);
      if (
        idx >= 0 &&
        idx < RISO_INKS.length &&
        !inks.includes(idx) &&
        inks.length < 4
      ) {
        inks.push(idx);
      }
    }
  }
  return seeds.length ? { inks, seeds } : null;
}

export const gridForSeedCount = (count: number): string =>
  count >= 16 ? "4" : count >= 4 ? "2" : "1";

// ---------------------------------------------------------------- renderer

export function OscillonRenderer(): React.JSX.Element {
  const { dispatch, state } = useToolcraft();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const cellsRef = React.useRef<Cell[]>([]);
  const rafRef = React.useRef(0);

  const width = state.canvas.size.width;
  const height = state.canvas.size.height;
  const renderScaleRaw = Number(state.values["canvas.renderScale"] ?? 1);
  const renderScale = renderScaleRaw === 2 ? 2 : 1;

  const recipe = readRecipe(state.values);
  const seedCsv = recipe.seeds.map(seedHex).join(",");
  const inkCsv = recipe.inks.join(",");
  const viewMode =
    String(state.values["view.mode"] ?? "paper") === "phosphor"
      ? ("phosphor" as const)
      : ("paper" as const);
  const backgroundHex = String(
    state.values["appearance.background"] ?? "#faf8f3",
  );
  const includeBackground = shouldIncludeToolcraftPreviewBackground({ state });

  // on load, a URL recipe hash overrides whatever persistence restored
  const restoredFromHashRef = React.useRef(false);
  React.useEffect(() => {
    const fromHash = parseRecipeHash(window.location.hash);
    if (!fromHash) return;
    restoredFromHashRef.current = true;
    dispatch({
      target: "inks.drums",
      type: "controls.setValue",
      value: fromHash.inks,
    });
    const grid = gridForSeedCount(fromHash.seeds.length);
    dispatch({ target: "sheet.grid", type: "controls.setValue", value: grid });
    if (grid === "1") {
      dispatch({
        target: "exposure.seed",
        type: "controls.setValue",
        value: seedHex(fromHash.seeds[0]),
      });
    } else {
      dispatch({
        target: "sheet.seeds",
        type: "controls.setValue",
        value: fromHash.seeds.map(seedHex).join(","),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // seed the very first exposure (and heal an empty seed after reset)
  React.useEffect(() => {
    if (restoredFromHashRef.current) {
      // the mount restore above already dispatched the real recipe
      restoredFromHashRef.current = false;
      return;
    }
    if (recipe.grid === 1 && recipe.seeds.length === 0) {
      dispatch({
        target: "exposure.seed",
        type: "controls.setValue",
        value: seedHex(pickSheetSeeds(state.values, 1)[0]),
      });
    }
    if (recipe.grid > 1 && recipe.seeds.length < recipe.grid * recipe.grid) {
      dispatch({
        target: "sheet.seeds",
        type: "controls.setValue",
        value: pickSheetSeeds(state.values, recipe.grid * recipe.grid)
          .map(seedHex)
          .join(","),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe.grid, recipe.seeds.length]);

  // mirror the recipe into the URL hash so pieces stay shareable
  React.useEffect(() => {
    if (!recipe.seeds.length) return;
    const hash = buildRecipeHash(recipe);
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", hash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedCsv, inkCsv]);

  // (re)build exposures whenever the recipe or develop size changes
  const developSize = developSizeFor(width, height, renderScale);
  React.useEffect(() => {
    const n = recipe.grid;
    const count = n * n;
    if (!recipe.seeds.length) {
      cellsRef.current = [];
      return;
    }
    const cellSize = Math.max(64, Math.floor(developSize / n));
    const inks = recipe.inks.map((idx) => RISO_INKS[idx]);
    const seeds = recipe.seeds.slice(0, count);
    cellsRef.current = seeds.map((seed) => ({
      exp: createExposure(seed, cellSize, samplesForSize(cellSize), inks),
      mapper: makeMapper(cellSize, cellSize >> 2),
      seed,
    }));
  }, [seedCsv, inkCsv, recipe.grid, developSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // develop + composite loop
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let needsComposite = true;

    const composite = () => {
      const w = Math.round(width * renderScale);
      const h = Math.round(height * renderScale);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const paper = hexToReflect(backgroundHex);
      ctx.clearRect(0, 0, w, h);
      if (includeBackground) {
        ctx.fillStyle = viewMode === "paper" ? backgroundHex : "#000";
        ctx.fillRect(0, 0, w, h);
      }
      const side = Math.min(w, h);
      const ox = (w - side) / 2;
      const oy = (h - side) / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const cells = cellsRef.current;
      const n = recipe.grid;
      if (n > 1) {
        const gap = Math.round(side * 0.01);
        const tile = (side - gap * (n - 1)) / n;
        for (let i = 0; i < cells.length; i++) {
          drawExposureTile(
            ctx,
            cells[i].exp,
            cells[i].mapper,
            ox + (i % n) * (tile + gap),
            oy + ((i / n) | 0) * (tile + gap),
            tile,
            viewMode,
            paper,
          );
        }
      } else if (cells[0]) {
        drawExposureTile(
          ctx,
          cells[0].exp,
          cells[0].mapper,
          ox,
          oy,
          side,
          viewMode,
          paper,
        );
      }
    };

    const loop = () => {
      const cells = cellsRef.current;
      const active = cells.filter((c) => c.exp.done < c.exp.total);
      if (active.length) {
        const per = Math.max(
          1,
          Math.round(DEVELOP_CHUNK / active.length),
        );
        for (const c of active) c.exp.develop(per);
        frame++;
        // the paper proof is heavier to write, refresh it less often
        const throttle = viewMode === "paper" ? 12 : 5;
        const finished = active.every((c) => c.exp.done >= c.exp.total);
        if (frame % throttle === 0 || finished) composite();
      } else if (needsComposite) {
        composite();
        needsComposite = false;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [
    seedCsv,
    inkCsv,
    recipe.grid,
    developSize,
    viewMode,
    backgroundHex,
    includeBackground,
    width,
    height,
    renderScale,
  ]);

  // double-click a contact-sheet cell to develop that seed full size.
  // Detected manually on pointerdown: the runtime canvas shell takes
  // pointer capture for pan/drag, so a native dblclick never reaches
  // the product canvas.
  const lastTapRef = React.useRef({ t: 0, x: 0, y: 0 });
  const handlePointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const now = performance.now();
    const last = lastTapRef.current;
    lastTapRef.current = { t: now, x: ev.clientX, y: ev.clientY };
    const isDoubleTap =
      now - last.t < 400 &&
      Math.abs(ev.clientX - last.x) < 12 &&
      Math.abs(ev.clientY - last.y) < 12;
    if (!isDoubleTap) return;
    const n = recipe.grid;
    if (n <= 1) return;
    const cells = cellsRef.current;
    const rect = ev.currentTarget.getBoundingClientRect();
    const side = Math.min(rect.width, rect.height);
    const ox = rect.left + (rect.width - side) / 2;
    const oy = rect.top + (rect.height - side) / 2;
    const cx = Math.floor(((ev.clientX - ox) / side) * n);
    const cy = Math.floor(((ev.clientY - oy) / side) * n);
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return;
    const cell = cells[cy * n + cx];
    if (!cell) return;
    dispatch({
      target: "exposure.seed",
      type: "controls.setValue",
      value: seedHex(cell.seed),
    });
    dispatch({ target: "sheet.grid", type: "controls.setValue", value: "1" });
  };

  return (
    <canvas
      aria-label="Oscillon exposure"
      className="block size-full"
      data-testid="oscillon-product-canvas"
      data-toolcraft-product-output=""
      onPointerDown={handlePointerDown}
      ref={canvasRef}
    />
  );
}
