# Oscillon Renderer Spec

## Renderer Technique Decision Matrix

Typed mirror lives in `src/app/app-performance.ts` (`rendererTechnique`,
`rendererPipeline`); this is the app spec decision it mirrors.

- sourceRepresentation: procedural-data (seeded beam samples).
- productRepresentation: pixel (accumulated light density).
- previewRenderer: canvas-2d. exportRenderer: canvas-2d.
- rendererWorkload: pixel-output. rendererStrategy: canvas-2d.
- whyNotAlternativeStrategies: the product is sequential seeded CPU
  accumulation with a percentile auto-exposure readback; WebGL/WebGPU
  would need float-atomic accumulation plus readbacks and would change
  the film physics. DOM/SVG (text-output / vector-output workloads)
  cannot represent per-pixel accumulated density. Measured CPU stress
  passes budgets (see measuredAlternativeEvidence).
- fidelityRisks: exports above the 2880px develop cap upscale smoothly;
  grain is intentionally non-deterministic.
- performanceRisks: main-thread develop (chunked at 10k samples/frame);
  paper-proof ImageData rewrite throttled to every 12th frame.
- exportRenderer note: export/copy re-develops offline at export size so
  product-quality export never resamples the preview.

### Renderer Layer Inventory

One product layer (rendererTechnique.layers):

- product-foreground layer "exposure": dense-pattern + noise content,
  high primitive count, canvas-2d, exportMode included, uiSelector
  `[data-testid="oscillon-product-canvas"]`. There is no separate
  backgroundLayer (the background is a schema color fill), no
  editingHandlesLayer, and the exportComposite is the same canvas-2d
  pass at export size.

### Render Pipeline Inventory

Typed in `rendererPipeline` (passes + interaction invalidation):

- passes: develop (rasterize, cacheKey seeds/inks/developSize/grid) →
  tone-map (pixel-transform, cacheKey develop-progress/view.mode) →
  composite (composite, cacheKey background/include/grid) →
  export-develop (export-only).
- interaction invalidation: control-change on seed/grid/drums
  invalidates develop; view/background control-change recomposites only
  and must not invalidate develop; viewport-drag and viewport-zoom
  invalidate nothing (mustNotInvalidate develop/tone-map);
  control-drag on canvas.renderScale re-targets the develop size;
  export invalidates export-develop only.

