import {
  defineToolcraftPerformance,
  type ToolcraftPerformanceConfig,
} from "@/toolcraft/runtime";

/*
  Oscillon renders by CPU accumulation: up to ~1.7M beam samples splat
  into Float32 buffers per exposure (chunked per animation frame), then
  a film-response tone map composites into the product canvas. The
  workload is bounded by the develop-size cap (2400px) regardless of
  canvas size, and sheets split the same sample budget across cells,
  so worst-case work is roughly constant.
*/

export const appPerformance: ToolcraftPerformanceConfig = defineToolcraftPerformance({
  browserCheckPolicy: {
    fallbackRunner: "playwright",
    fallbackWhen: ["agent-browser-unavailable", "ci"],
    preferredRunner: "agent-browser",
  },
  rendererPipeline: {
    interactionInvalidation: [
      {
        interaction: "control-change",
        invalidates: ["develop", "tone-map", "composite"],
        targets: [
          "exposure.seed",
          "sheet.grid",
          "inks.drums",
          "exposure.character",
          "exposure.figure",
        ],
      },
      {
        interaction: "control-change",
        invalidates: ["tone-map", "composite"],
        mustNotInvalidate: ["develop"],
        targets: [
          "view.mode",
          "appearance.background",
          "export.includeBackground",
        ],
      },
      {
        interaction: "viewport-drag",
        invalidates: [],
        mustNotInvalidate: ["develop", "tone-map"],
        targets: ["canvas.offset"],
      },
      {
        interaction: "viewport-zoom",
        invalidates: [],
        mustNotInvalidate: ["develop", "tone-map"],
        targets: ["canvas.zoom"],
      },
      {
        interaction: "control-drag",
        invalidates: ["develop", "tone-map", "composite"],
        targets: ["canvas.renderScale"],
      },
      {
        interaction: "export",
        invalidates: ["export-develop"],
        mustNotInvalidate: ["develop"],
        targets: ["export.image.resolution", "export.image.format"],
      },
    ],
    passes: [
      {
        cacheKey: ["seeds", "inks", "developSize", "grid"],
        id: "develop",
        inputs: ["seed", "ink drums", "develop size"],
        invalidatedBy: [
          "exposure.seed",
          "sheet.grid",
          "inks.drums",
          "canvas.renderScale",
          "canvas.size",
        ],
        kind: "rasterize",
        output: "intermediate",
        quality: "full",
        runsOn: "main",
      },
      {
        cacheKey: ["develop-progress", "view.mode"],
        id: "tone-map",
        inputs: ["develop"],
        invalidatedBy: ["develop", "view.mode"],
        kind: "pixel-transform",
        output: "intermediate",
        quality: "full",
        runsOn: "main",
      },
      {
        cacheKey: [
          "tone-map",
          "appearance.background",
          "export.includeBackground",
          "grid",
        ],
        id: "composite",
        inputs: ["tone-map"],
        invalidatedBy: [
          "tone-map",
          "appearance.background",
          "export.includeBackground",
        ],
        kind: "composite",
        output: "preview",
        quality: "full",
        runsOn: "main",
      },
      {
        id: "export-develop",
        inputs: ["seed", "ink drums", "export resolution"],
        invalidatedBy: ["export.image.resolution"],
        kind: "export",
        output: "export",
        quality: "export",
        runsOn: "main",
      },
    ],
  },
  rendererStrategy: "canvas-2d",
  rendererTechnique: {
    exportRenderer: "canvas-2d",
    fidelityRisks: [
      "Export resolutions beyond the 2880px develop cap upscale the composite smoothly; the 2400px print masters remain the pixel-exact ground truth for print.",
      "Film grain (unseeded jitter) intentionally differs between two develops of the same seed; the figure is deterministic, the grain is not.",
    ],
    layers: [
      {
        content: ["dense-pattern", "noise"],
        exportMode: "included",
        id: "exposure",
        kind: "product-foreground",
        primitiveCount: "high",
        renderer: "canvas-2d",
        uiSelector: '[data-testid="oscillon-product-canvas"]',
      },
    ],
    performanceRisks: [
      "Develop is CPU-bound Float32 accumulation on the main thread; it is chunked at 10k samples per animation frame so frames never block on the full 1.7M-sample exposure.",
      "The paper proof pass rewrites a full-resolution ImageData per refresh; it is throttled to every 12th develop frame.",
    ],
    measuredAlternativeEvidence: [
      {
        alternativeStrategy: "webgl",
        decision:
          "Keep Canvas 2D CPU accumulation. The product's film physics is sequential seeded splatting (bilinear Float32 accumulation with per-sample stochastic grain) plus a percentile auto-exposure readback per tone-map; a WebGL port needs float-atomic accumulation or additive point sprites plus per-frame readbacks and changes the output. The measured CPU stress run passes the frame-gap and long-task budgets, so the GPU rewrite is not justified.",
        fixture:
          "seed ce14a048 (silk, max cycles) at the 2400px develop cap, render scale 2, 180-frame probe during develop",
        measuredResult:
          "agent-browser checkpoint (2026-07-13): max frame gap 62ms, max long task 55ms over 180 frames during the stress develop; 4x4 sheet 115ms/110ms; view toggle 52ms (budgets 120ms frame gap / 250ms long task / 500ms interaction).",
        scenarioId: "develop-workload",
      },
    ],
    previewRenderer: "canvas-2d",
    productRepresentation: "pixel",
    rendererStrategy: "canvas-2d",
    rendererWorkload: "pixel-output",
    sourceRepresentation: "procedural-data",
    whyNotAlternativeStrategies: [
      "The product IS stochastic CPU accumulation: 1.7M sequential beam samples with data-dependent bilinear splats and unseeded per-sample grain. WebGL/WebGPU would need float atomics or additive point sprites plus a readback for the percentile auto-exposure, changing the film physics that defines the output. The chunked develop keeps the largest useful workload (2400px develop, 4×4 sheets, max canvas with 2x render scale) inside frame-gap budgets on the stress fixture, so Canvas 2D holds.",
      "DOM/SVG cannot represent per-pixel accumulated light density at all.",
    ],
  },
  rendererWorkload: "pixel-output",
  scenarios: [
    {
      automated: true,
      automatedTestName:
        "automated: develop workload stays chunked for max-size single exposures",
      browser: true,
      browserTestName:
        "browser perf: committing a seed develops without blocking frames",
      budget: {
        maxFrameGapMs: 120,
        maxInteractionMs: 2000,
        maxLongTaskMs: 250,
      },
      controlLabel: "Seed",
      expectedObservable:
        "Committing a new seed at max develop size starts a chunked develop; frames keep presenting while the figure forms.",
      fixture:
        "Canvas 1200x1200 at render scale 2 (develop cap 2400px), silk seed ce14a048 committed via the Seed control.",
      id: "develop-workload",
      interaction: "control-change",
      stress: true,
      stressFixture: {
        kind: "max-value",
        loadProfile: {
          hardLimit: "ce14a048",
          metric: "custom",
          smoothTarget: "ce14a048",
          smoothTargetRatio: 1,
          target: "exposure.seed",
          userFacingRange: "fully-guaranteed",
        },
        reason:
          "2400px is the develop-size cap, and silk seeds carry the highest cycle counts (240-520), so this seed is the heaviest single-exposure develop the app can run.",
        value: "ce14a048",
      },
      target: "exposure.seed",
      values: { default: "0cb09815", max: "ce14a048", min: "00000001" },
      workload: true,
      workloadFixture: {
        kind: "max-value",
        loadProfile: {
          hardLimit: "render scale 2 at 1200x1200 canvas",
          metric: "custom",
          smoothTarget: "render scale 2 at 1200x1200 canvas",
          smoothTargetRatio: 1,
          target: "canvas.renderScale",
          userFacingRange: "fully-guaranteed",
        },
        reason:
          "Render scale 2 with the default 1200px canvas puts the develop buffer at its 2400px cap before the seed commits.",
        value: "render scale 2 at 1200x1200 canvas",
      },
    },
    {
      automated: true,
      automatedTestName:
        "automated: develop workload stays chunked for max-size single exposures",
      browser: true,
      browserTestName:
        "browser perf: max develop stress keeps frames presenting",
      budget: {
        maxFrameGapMs: 120,
        maxLongTaskMs: 250,
        maxRenderMs: 2000,
      },
      expectedObservable:
        "The heaviest silk develop at the 2400px cap keeps presenting frames while the preview forms.",
      fixture:
        "Canvas 1200x1200 at render scale 2 (develop cap 2400px), silk seed ce14a048.",
      id: "develop-stress",
      interaction: "preview-render",
      stress: true,
      stressFixture: {
        kind: "max-value",
        loadProfile: {
          hardLimit: "ce14a048",
          metric: "custom",
          smoothTarget: "ce14a048",
          smoothTargetRatio: 1,
          target: "exposure.seed",
          userFacingRange: "fully-guaranteed",
        },
        reason:
          "Silk seeds carry the highest cycle counts, and 2400px is the develop cap — the heaviest preview render the app can produce.",
        value: "ce14a048",
      },
      target: "exposure.seed",
      workload: false,
    },
    {
      automated: true,
      automatedTestName:
        "automated: sheet workload splits the sample budget across cells",
      browser: true,
      browserTestName:
        "browser perf: a 4x4 sheet develops without blocking frames",
      budget: {
        maxFrameGapMs: 120,
        maxInteractionMs: 2000,
        maxLongTaskMs: 250,
      },
      expectedObservable:
        "Switching to 4×4 develops sixteen cells concurrently; total sample budget matches a single exposure so frames keep presenting.",
      fixture: "Canvas 1200x1200 at render scale 2, grid switched to 4×4.",
      controlLabel: "Grid",
      id: "sheet-workload",
      interaction: "control-change",
      stressFixture: {
        kind: "max-value",
        loadProfile: {
          hardLimit: 4,
          metric: "count",
          smoothTarget: 4,
          smoothTargetRatio: 1,
          target: "sheet.grid",
          userFacingRange: "fully-guaranteed",
        },
        reason:
          "4×4 is the largest sheet; sixteen concurrent develops share one sample budget.",
        value: 4,
      },
      target: "sheet.grid",
      values: { default: "1", max: "4", min: "1" },
      workload: true,
      workloadFixture: {
        kind: "max-value",
        loadProfile: {
          hardLimit: "render scale 2 at 1200x1200 canvas",
          metric: "custom",
          smoothTarget: "render scale 2 at 1200x1200 canvas",
          smoothTargetRatio: 1,
          target: "canvas.renderScale",
          userFacingRange: "fully-guaranteed",
        },
        reason:
          "Render scale 2 with the default 1200px canvas puts the develop buffer at its 2400px cap before the grid switch.",
        value: "render scale 2 at 1200x1200 canvas",
      },
    },
    {
      automated: true,
      automatedTestName:
        "automated: character filter constrains picked seeds to the requested character",
      browser: true,
      browserTestName:
        "browser perf: character filter selection responds instantly",
      budget: { maxFrameGapMs: 120, maxInteractionMs: 500 },
      controlLabel: "Character",
      expectedObservable:
        "Selecting a character cell updates the filter instantly; nothing redevelops until Generate.",
      fixture: "Default app state; the silk cell selected.",
      id: "character-responsiveness",
      interaction: "control-change",
      target: "exposure.character",
      workload: false,
    },
    {
      automated: true,
      automatedTestName:
        "automated: figure filter constrains picked seeds to the requested mode",
      browser: true,
      browserTestName:
        "browser perf: figure filter selection responds instantly",
      budget: { maxFrameGapMs: 120, maxInteractionMs: 500 },
      controlLabel: "Figure",
      expectedObservable:
        "Choosing a figure option updates the filter instantly; nothing redevelops until Generate.",
      fixture: "Default app state; Damped spiral chosen.",
      id: "figure-responsiveness",
      interaction: "control-change",
      target: "exposure.figure",
      workload: false,
    },
    {
      automated: true,
      automatedTestName:
        "automated: ink combo picks a proven pair and clear empties the drums",
      browser: true,
      browserTestName:
        "browser perf: ink combo and clear respond within budget",
      budget: { maxFrameGapMs: 120, maxInteractionMs: 2000 },
      controlLabel: "Combo",
      expectedObservable:
        "Combo swaps the drum selection (starting a fresh chunked develop); Clear empties it. Frames keep presenting.",
      fixture: "A developed single exposure.",
      id: "ink-actions-responsiveness",
      interaction: "control-change",
      target: "inks.actions",
      workload: false,
    },
    {
      automated: true,
      automatedTestName:
        "automated: include-background gates the preview background",
      browser: true,
      browserTestName:
        "browser perf: include background toggles without redeveloping",
      budget: { maxFrameGapMs: 120, maxInteractionMs: 500 },
      controlLabel: "Include",
      expectedObservable:
        "Toggling Include recomposites the settled buffers without restarting the develop.",
      fixture: "A fully developed single exposure.",
      id: "include-background-responsiveness",
      interaction: "control-change",
      target: "export.includeBackground",
      workload: false,
    },
    {
      automated: true,
      automatedTestName:
        "automated: the paper color feeds the proof compositor",
      browser: true,
      browserTestName:
        "browser perf: background color retints without redeveloping",
      budget: { maxFrameGapMs: 120, maxInteractionMs: 500 },
      controlLabel: "Include",
      expectedObservable:
        "Committing a new background hex recomposites the settled buffers without restarting the develop.",
      fixture: "A fully developed single exposure in paper view.",
      id: "background-responsiveness",
      interaction: "control-change",
      target: "appearance.background",
      workload: false,
    },
    {
      automated: true,
      automatedTestName:
        "automated: export format select carries png and jpg options",
      browser: true,
      browserTestName:
        "browser perf: choosing an export format responds instantly",
      budget: { maxFrameGapMs: 120, maxInteractionMs: 500 },
      controlLabel: "Format",
      expectedObservable:
        "Selecting PNG or JPG updates the export setting instantly; nothing re-renders until an export runs.",
      fixture: "A developed single exposure; each format selected.",
      id: "format-responsiveness",
      interaction: "control-change",
      target: "export.image.format",
      workload: false,
    },
    {
      automated: true,
      automatedTestName:
        "automated: view and background changes recomposite without redeveloping",
      browser: true,
      browserTestName:
        "browser perf: view mode responds without redeveloping",
      budget: { maxFrameGapMs: 120, maxInteractionMs: 500 },
      controlLabel: "Mode",
      expectedObservable:
        "Flipping paper/phosphor recomposites the existing buffers; the develop pass does not restart.",
      fixture: "A fully developed single exposure.",
      id: "view-responsiveness",
      interaction: "control-change",
      target: "view.mode",
      workload: false,
    },
    {
      automated: true,
      automatedTestName:
        "automated: viewport interactions never invalidate the develop pass",
      browser: true,
      browserTestName:
        "browser perf: canvas drag and zoom stay stable during develop",
      budget: { maxFrameGapMs: 120 },
      expectedObservable:
        "Dragging and zooming the canvas while an exposure develops keeps presenting frames and never restarts the develop.",
      fixture:
        "A developing 4×4 sheet; pointer drag across the viewport plus zoom in/out.",
      id: "viewport-stability",
      interaction: "viewport-stability",
      workload: false,
    },
    {
      automated: true,
      automatedTestName:
        "automated: ink selection changes the exposure separations but not the figure",
      browser: true,
      browserTestName:
        "browser perf: selecting four ink drums redevelops within budget",
      budget: {
        maxFrameGapMs: 120,
        maxInteractionMs: 2000,
        maxLongTaskMs: 250,
      },
      expectedObservable:
        "Selecting the maximum four drums redevelops the exposure with four separation bands while frames keep presenting.",
      fixture:
        "A developed single exposure; four ink swatches clicked in sequence.",
      id: "inks-workload",
      interaction: "control-change",
      stressFixture: {
        kind: "max-value",
        loadProfile: {
          hardLimit: [25, 11, 4, 23],
          metric: "count",
          smoothTarget: [25, 11, 4, 23],
          smoothTargetRatio: 1,
          target: "inks.drums",
          userFacingRange: "fully-guaranteed",
        },
        reason:
          "Four drums is the ink cap and the maximum separation-band count per develop.",
        value: [25, 11, 4, 23],
      },
      target: "inks.drums",
      uiSelector: '[data-testid="oscillon-ink-drums"]',
      values: { default: [], max: [25, 11, 4, 23], min: [] },
      workload: true,
      workloadFixture: {
        kind: "max-value",
        loadProfile: {
          hardLimit: "render scale 2 at 1200x1200 canvas",
          metric: "custom",
          smoothTarget: "render scale 2 at 1200x1200 canvas",
          smoothTargetRatio: 1,
          target: "canvas.renderScale",
          userFacingRange: "fully-guaranteed",
        },
        reason:
          "Render scale 2 keeps the develop buffer at its 2400px cap while the drums change.",
        value: "render scale 2 at 1200x1200 canvas",
      },
    },
    {
      automated: true,
      automatedTestName:
        "automated: render scale rescales the develop buffer",
      browser: true,
      browserTestName:
        "browser perf: dragging resolution scale stays responsive",
      budget: {
        maxFrameGapMs: 120,
        maxInteractionMs: 2000,
        maxLongTaskMs: 250,
      },
      controlLabel: "Resolution scale",
      expectedObservable:
        "Dragging the runtime Resolution scale slider re-targets the develop size without blocking frames.",
      fixture: "Default single exposure; Resolution scale dragged 2 -> 1.",
      id: "render-scale-drag",
      interaction: "control-drag",
      target: "canvas.renderScale",
      workload: false,
    },
    {
      automated: true,
      automatedTestName:
        "automated: viewport interactions never invalidate the develop pass",
      browser: true,
      browserTestName:
        "browser perf: zooming under a developing sheet stays within budget",
      budget: {
        maxFrameGapMs: 120,
        maxInteractionMs: 2000,
        maxLongTaskMs: 250,
      },
      expectedObservable:
        "Repeated zoom in/out over a developing 4×4 sheet keeps presenting frames; the develop never restarts.",
      fixture: "A developing 4×4 sheet; repeated toolbar zoom in/out.",
      id: "zoom-stress",
      interaction: "viewport-zoom-stress",
      stress: true,
      stressFixture: {
        kind: "max-value",
        loadProfile: {
          hardLimit: "render scale 2 at 1200x1200 canvas, 4x4 sheet",
          metric: "custom",
          smoothTarget: "render scale 2 at 1200x1200 canvas, 4x4 sheet",
          smoothTargetRatio: 1,
          target: "sheet.grid",
          userFacingRange: "fully-guaranteed",
        },
        reason:
          "A developing 4×4 sheet at the develop cap is the heaviest state the viewport can be zoomed over.",
        value: "render scale 2 at 1200x1200 canvas, 4x4 sheet",
      },
      workload: false,
    },
    {
      automated: true,
      automatedTestName:
        "automated: export resolution maps to real long-edge pixel sizes",
      browser: true,
      browserTestName:
        "browser perf: choosing an export resolution responds instantly",
      budget: { maxFrameGapMs: 120, maxInteractionMs: 500 },
      controlLabel: "Resolution",
      expectedObservable:
        "Selecting 2K/4K/8K updates the export setting instantly; nothing re-renders until an export runs.",
      fixture: "A developed single exposure; each resolution selected.",
      id: "resolution-change",
      interaction: "control-change",
      stressFixture: {
        kind: "max-value",
        loadProfile: {
          hardLimit: "8k",
          metric: "custom",
          smoothTarget: "8k",
          smoothTargetRatio: 1,
          target: "export.image.resolution",
          userFacingRange: "fully-guaranteed",
        },
        reason:
          "Selecting any resolution, including 8K, is an instant settings write.",
        value: "8k",
      },
      target: "export.image.resolution",
      values: { default: "4k", max: "8k", min: "2k" },
      workload: true,
      workloadFixture: {
        kind: "max-value",
        loadProfile: {
          hardLimit: "render scale 2 at 1200x1200 canvas",
          metric: "custom",
          smoothTarget: "render scale 2 at 1200x1200 canvas",
          smoothTargetRatio: 1,
          target: "canvas.renderScale",
          userFacingRange: "fully-guaranteed",
        },
        reason:
          "A fully developed max-cap exposure is on screen while the setting changes.",
        value: "render scale 2 at 1200x1200 canvas",
      },
    },
    {
      automated: true,
      automatedTestName:
        "automated: png export develops offline at the selected resolution",
      browser: true,
      browserTestName: "browser perf: 2k png export completes within budget",
      budget: { maxExportMs: 8000 },
      expectedObservable:
        "Export PNG at 2K redevelops offline at 2048px and downloads within the export budget.",
      fixture:
        "A developed single ghost exposure, format png, resolution 2k.",
      controlLabel: "Resolution",
      id: "export-budget",
      interaction: "export-copy",
      stressFixture: {
        kind: "max-value",
        loadProfile: {
          degradationStepPercent: 10,
          evidence: [
            {
              attemptedTarget: "4k",
              decision:
                "Keep the export-time budget scenario at 2K; 4K/8K exports intentionally run past the 8s budget (they redevelop millions of beam samples offline with sticky-footer progress) and remain available to the user.",
              measuredResult:
                "2K export completes within the 8s budget in the agent browser; 4K measured ~25-40s and 8K minutes-scale.",
              optimizationAttempted:
                "Export develop chunk raised to 80k samples per tick; develop capped at 2880px with smooth upscale beyond.",
              result: "failed",
              scenarioId: "export-budget",
            },
          ],
          hardLimit: "8k",
          metric: "custom",
          smoothTarget: "2k",
          smoothTargetRatio: 0.9,
          target: "export.image.resolution",
          userFacingRange: "experimental-above-smooth",
        },
        reason:
          "2K is the largest export that fits the 8s export budget; higher resolutions are progress-reported long tasks by design.",
        value: "2k",
      },
      target: "export.image.resolution",
      values: { default: "2k", max: "8k", min: "2k" },
      workload: true,
    },
  ],
  usesCustomRenderer: true,
  workloadTargets: [
    "exposure.seed",
    "sheet.grid",
    "inks.drums",
    "export.image.resolution",
  ],
});
