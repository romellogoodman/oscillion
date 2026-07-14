import {
  createToolcraftPngExportCanvas,
  type ToolcraftCommand,
  type ToolcraftState,
} from "@/toolcraft/runtime";

import {
  PRINT_SIZE,
  RISO_INKS,
  createExposure,
  describe,
  developOffline,
  downloadCanvas,
  drawExposureTile,
  fileBase,
  hexToReflect,
  inkSlug,
  makeMapper,
  makePlane,
  percentileBands,
  randomInkCombo,
  samplesForSize,
  seedHex,
  writeMaster,
  writeProof,
  type Exposure,
} from "./oscillon-engine";
import { pickSheetSeeds, readRecipe } from "./oscillon-renderer";

/*
  Sticky panel actions (Generate / Export PNG / Print Masters) and the
  local ink-section actions (Combo / Clear). Exports re-develop the
  recipe off-screen at export resolution — the preview buffers are
  never resampled — then blit into the runtime export canvas.
*/

type PanelActionPayload = {
  action: { value: string };
  dispatch: (command: ToolcraftCommand) => void;
  reportProgress: (fraction: number) => void;
  state: ToolcraftState;
};

// exports re-develop at real pixel size, capped where Float32
// accumulation buffers would exceed sane memory (8K would need ~800MB);
// beyond the cap the composite is smoothly upscaled
const MAX_EXPORT_DEVELOP = 2880;

function setValue(
  dispatch: PanelActionPayload["dispatch"],
  target: string,
  value: unknown,
): void {
  dispatch({ target, type: "controls.setValue", value });
}

function generate(payload: PanelActionPayload): void {
  const { dispatch, state } = payload;
  const recipe = readRecipe(state.values);
  if (recipe.grid > 1) {
    setValue(
      dispatch,
      "sheet.seeds",
      pickSheetSeeds(state.values, recipe.grid * recipe.grid)
        .map(seedHex)
        .join(","),
    );
    return;
  }
  setValue(
    dispatch,
    "exposure.seed",
    seedHex(pickSheetSeeds(state.values, 1)[0]),
  );
}

async function developRecipeSquare(
  state: ToolcraftState,
  size: number,
  onProgress: (fraction: number) => void,
): Promise<{ cells: { exp: Exposure; seed: number }[]; grid: number }> {
  const recipe = readRecipe(state.values);
  const inks = recipe.inks.map((idx) => RISO_INKS[idx]);
  const n = recipe.grid;
  const count = n * n;
  const seeds = recipe.seeds.slice(0, count);
  const cellSize = Math.max(64, Math.floor(size / n));
  const cells: { exp: Exposure; seed: number }[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const exp = createExposure(
      seeds[i],
      cellSize,
      samplesForSize(cellSize),
      inks,
    );
    await developOffline(exp, (f) =>
      onProgress((i + f) / Math.max(1, seeds.length)),
    );
    cells.push({ exp, seed: seeds[i] });
  }
  return { cells, grid: n };
}

async function exportImage(payload: PanelActionPayload): Promise<void> {
  const { reportProgress, state } = payload;
  const format = String(state.values["export.image.format"] ?? "png");
  const exportResolution = String(
    state.values["export.image.resolution"] ?? "4k",
  );
  const viewMode =
    String(state.values["view.mode"] ?? "paper") === "phosphor"
      ? ("phosphor" as const)
      : ("paper" as const);
  const backgroundHex = String(
    state.values["appearance.background"] ?? "#faf8f3",
  );
  const paper = hexToReflect(backgroundHex);

  const longEdge =
    exportResolution === "8k" ? 8192 : exportResolution === "2k" ? 2048 : 4096;
  const developSize = Math.min(MAX_EXPORT_DEVELOP, longEdge);
  const { cells, grid } = await developRecipeSquare(state, developSize, (f) =>
    reportProgress(f * 0.9),
  );

  const exportCanvas = createToolcraftPngExportCanvas({
    includeBackground: Boolean(state.values["export.includeBackground"]),
    render: ({ context, includeBackground, pixelHeight, pixelWidth }) => {
      context.clearRect(0, 0, pixelWidth, pixelHeight);
      if (includeBackground) {
        context.fillStyle = viewMode === "paper" ? backgroundHex : "#000";
        context.fillRect(0, 0, pixelWidth, pixelHeight);
      }
      const side = Math.min(pixelWidth, pixelHeight);
      const ox = (pixelWidth - side) / 2;
      const oy = (pixelHeight - side) / 2;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      if (grid > 1) {
        const gap = Math.round(side * 0.01);
        const tile = (side - gap * (grid - 1)) / grid;
        for (let i = 0; i < cells.length; i++) {
          const mapper = makeMapper(cells[i].exp.S, cells[i].exp.G);
          drawExposureTile(
            context,
            cells[i].exp,
            mapper,
            ox + (i % grid) * (tile + gap),
            oy + ((i / grid) | 0) * (tile + gap),
            tile,
            viewMode,
            paper,
          );
        }
      } else if (cells[0]) {
        const mapper = makeMapper(cells[0].exp.S, cells[0].exp.G);
        drawExposureTile(
          context,
          cells[0].exp,
          mapper,
          ox,
          oy,
          side,
          viewMode,
          paper,
        );
      }
    },
    resolution: exportResolution,
    state,
  });
  reportProgress(0.97);

  const single = grid === 1 ? cells[0] : null;
  const base = single
    ? fileBase(single.exp.P, single.seed)
    : `oscillon-sheet-${grid}x${grid}`;
  const mime = format === "jpg" ? "image/jpeg" : "image/png";
  await downloadCanvas(exportCanvas, `${base}.${format}`, mime);
  reportProgress(1);
}

async function exportMasters(payload: PanelActionPayload): Promise<void> {
  const { reportProgress, state } = payload;
  const recipe = readRecipe(state.values);
  if (recipe.grid > 1 || !recipe.seeds.length) return;
  const seed = recipe.seeds[0];
  const inks = recipe.inks.map((idx) => RISO_INKS[idx]);
  const size = PRINT_SIZE;
  const backgroundHex = String(
    state.values["appearance.background"] ?? "#faf8f3",
  );
  const paper = hexToReflect(backgroundHex);

  const exp = createExposure(seed, size, samplesForSize(size), inks);
  await developOffline(exp, (f) => reportProgress(f * 0.85));

  const base = fileBase(exp.P, seed);

  // 1. emissive composite for reference
  const composite = document.createElement("canvas");
  composite.width = size;
  composite.height = size;
  const compositeCtx = composite.getContext("2d");
  if (!compositeCtx) return;
  const mapper = makeMapper(size, exp.G);
  drawExposureTile(compositeCtx, exp, mapper, 0, 0, size, "phosphor", paper);
  await downloadCanvas(composite, `${base}-print.png`);

  // 2. one grey master per drum, dark ink on white, shared exposure
  const K = percentileBands(exp.bands, size, 2.8);
  for (let i = 0; i < exp.bands.length; i++) {
    const plane = makePlane(size);
    writeMaster(plane.data.data, exp.bands[i], size, K);
    plane.ctx.putImageData(plane.data, 0, 0);
    const layer = exp.P.inks
      ? `master-${i + 1}-${inkSlug(exp.P.inks[i].name)}`
      : `master-${i + 1}`;
    // browsers throttle rapid successive downloads
    await new Promise((r) => setTimeout(r, 350));
    await downloadCanvas(plane.canvas, `${base}-${layer}.png`);
    reportProgress(0.85 + ((i + 1) / (exp.bands.length + 1)) * 0.15);
  }

  // 3. paper proof at print size — the shop's color reference
  const proofPlane = makePlane(size);
  writeProof(proofPlane.data.data, exp, size, paper);
  proofPlane.ctx.putImageData(proofPlane.data, 0, 0);
  await new Promise((r) => setTimeout(r, 350));
  await downloadCanvas(proofPlane.canvas, `${base}-proof.png`);
  reportProgress(1);
}

export function handlePanelAction(
  payload: PanelActionPayload,
): Promise<void> | void {
  switch (payload.action.value) {
    case "generate":
      generate(payload);
      return;
    case "export-png":
      return exportImage(payload);
    case "export-masters":
      return exportMasters(payload);
    case "ink-combo":
      setValue(payload.dispatch, "inks.drums", randomInkCombo());
      return;
    case "ink-clear":
      setValue(payload.dispatch, "inks.drums", []);
      return;
  }
}

export { describe };
