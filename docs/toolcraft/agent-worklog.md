# Implementation Worklog

This file records product decisions and the evidence behind them.

## Status

Mode: product

Oscillon — a personal design tool generating simulated oscilloscope long
exposures (after Ben Laposky) destined for risograph prints on white
paper. Ported from this repository's pre-Toolcraft app (commit 720a690)
as a reference-runtime clone.

## Decision Trail

### Iteration 1 — Port Oscillon into the Toolcraft runtime

- Request: "toolcraft is a library. use that — npx @pixel-point/toolcraft
  create" following "redo the ui/ux … so it feels more like a tool".
- Task type: generated app porting (reference-runtime clone) + custom
  renderer + custom control + export actions.
- User-visible result: the Oscillon engine runs inside the Toolcraft
  shell: Exposure (character/figure filters, seed), Contact sheet grid,
  Inks drum picker with Combo/Clear, View paper/phosphor, Background,
  Image Export, and sticky Generate / Export PNG / Print Masters actions.
  Recipes stay shareable through the URL hash.
- Source/reference checked: `git show 720a690:src/App.jsx` (reference
  runtime, run live in the agent browser before the port); Laposky
  reference photographs in ~/Desktop/oscillion-examples informed the
  existing engine, not this port.
- Reference inputs: reference app source at commit 720a690; Toolcraft
  local docs; https://pixelpoint.io/blog/how-to-craft-personal-design-tools-with-toolcraft/.
- Docs/contracts read: AGENTS.md, workflow.md, core/runtime-boundary.md,
  assembly-workflow.md, schema-reference.md, core/control-selection.md,
  core/layout.md, custom-controls.md, component-rules.md (routed),
  core/setup-export.md, renderer-technique.md, acceptance-testing.md,
  performance.md excerpts, decision-contract rule ids.
- Contract rules applied: runtime-shell-required, canvas-no-app-ui,
  controls-product-coverage, output-export-required,
  renderer-technique-inventory, reference-clone-source-of-truth,
  acceptance-product-observable, persistence-policy-explicit,
  workflow-required.
- Decision: keep the engine byte-compatible (same seeded draw order) in
  `src/app/oscillon-engine.ts`; product renderer in `canvasContent`
  hosts the chunked develop loop; all state in runtime values; exports
  re-develop off-screen at export resolution.
- Alternatives rejected: hand-rolled side panel (previous iteration,
  rejected in favor of the Toolcraft runtime per user request); WebGL
  accumulation (changes the film physics; see performance matrix);
  keeping the URL hash out (recipes are the product's identity for the
  print pipeline, so the renderer mirrors them).
- State/output mapping: exposure.seed / sheet.seeds / sheet.grid /
  inks.drums invalidate the develop pass; view.mode /
  appearance.background / export.includeBackground only recomposite;
  export.image.* select export develop size and encoding; panel actions
  generate (writes seed values) or export (reads state, downloads
  files); double-click on a sheet cell writes exposure.seed +
  sheet.grid through runtime commands.
- Files changed: src/app/oscillon-engine.ts, src/app/app-schema.ts,
  src/app/oscillon-renderer.tsx, src/app/ink-drums-control.tsx,
  src/app/app-actions.ts, src/routes/index.tsx, src/app/app-acceptance.ts,
  src/app/app-performance.ts, src/app/oscillon-app.test.ts,
  e2e/app-controls.spec.ts, e2e/app-product-perf.spec.ts, index.html,
  package.json.
- Verification: `npm run verify:final` (typecheck, docs/integrity
  checks, unit suite, build, browser acceptance) plus the agent-browser
  performance checkpoint; see Verification below.
- Skipped checks: none for first product delivery.
- Risks: see Risks.

## Decisions

### Renderer

- Decision: Canvas 2D custom renderer in `canvasContent`
  (`OscillonRenderer`), preview and export both Canvas 2D.
- Reason: the product is stochastic CPU accumulation — 1.7M sequential
  beam samples with data-dependent bilinear splats, film-response tone
  mapping, and a percentile auto-exposure readback. WebGL/WebGPU would
  need float atomics/point-sprite accumulation plus readbacks and would
  change the film physics that defines the output.
- Evidence: rendererTechnique + rendererPipeline in
  `src/app/app-performance.ts`; stress scenario `develop-workload`
  (silk seed ce14a048 at the 2400px develop cap) passes frame-gap and
  long-task budgets because develop is chunked at 10k samples per
  animation frame; `browser perf:` suite in e2e/app-product-perf.spec.ts.

### Timeline

- Decision: no timeline.
- Reason: still-image product; the live develop is autonomous decorative
  progress toward a still, with no transport and no video export.
- Evidence: `panels.timeline` omitted; animationIntent mode "none".

### Layers

- Decision: no layers.
- Reason: single product object (the exposure / sheet); no reorderable
  entities.
- Evidence: `panels.layers` omitted.

### Controls

- Decision: sections by workflow stage/entity — Exposure, Contact
  sheet, Inks, View, Background (required), Image Export (required) —
  plus sticky Generate/Export PNG/Print Masters. One custom control
  (`inkDrums`): ordered bounded multi-select over the fixed 34-ink
  Risolve wheel where selection order is drum order.
- Reason: built-ins fit everything else (segmented/select/text/switch/
  color/actions); no built-in owns ordered multi-select over a fixed
  swatch set (fit check in app-acceptance.ts checked imagePicker,
  palette, collectionActions, actions, select).
- Evidence: `starterControlSectionInventory` and `builtInFitCheck` in
  src/app/app-acceptance.ts; browser acceptance for every control in
  e2e/app-controls.spec.ts.

### Export

- Decision: sticky `panelActions`: Export PNG (format/resolution from
  the Image Export section, via `createToolcraftPngExportCanvas`) and
  Print Masters (2400px composite + one grey master per drum + paper
  proof, the riso pipeline's ground truth). Exports re-develop
  off-screen at export size with progress reported to the sticky
  accent.
- Reason: real 2048/4096/8192 long edges per contract; masters must be
  pixel-exact at print size, so they never resample the preview.
- Evidence: app-actions.ts; browser tests verify JPG magic bytes, the
  2048px long edge, and the four master filenames.

### Performance

- Decision: cap the develop buffer at 2400px (preview) / 2880px
  (export) and chunk develop at 10k samples per animation frame; sheets
  split the same sample budget across cells so total work is constant;
  the paper proof recomposite is throttled to every 12th develop frame.
- Reason: Float32 accumulation buffers scale with size² (8192px would
  need ~800MB); chunking keeps frame gaps inside budget on the stress
  fixture.
- Evidence: scenarios in app-performance.ts (develop-workload with
  stressFixture seed ce14a048, sheet-workload, view-responsiveness,
  viewport-stability, export-budget at 2K); `browser perf:` tests in
  e2e/app-product-perf.spec.ts. Export resolutions above the develop
  cap upscale smoothly — recorded as a fidelity risk, masters remain
  exact.

## Renderer Spec

The Renderer Technique Decision Matrix, Renderer Layer Inventory, and
Render Pipeline Inventory live in `docs/oscillon-renderer-spec.md`
(mirrored in typed config in `src/app/app-performance.ts`).

## Evidence

- Source reviewed: git show 720a690:src/App.jsx (reference runtime),
  src/app/oscillon-engine.ts, src/app/app-schema.ts,
  src/app/oscillon-renderer.tsx, src/app/app-actions.ts,
  docs/toolcraft/schema-reference.md, docs/toolcraft/core/setup-export.md,
  docs/toolcraft/renderer-technique.md.
- Contract applied: runtime-shell-required, canvas-no-app-ui,
  controls-product-coverage, output-export-required,
  reference-clone-source-of-truth, acceptance-product-observable.
- Reference behavior verified live before the port (agent browser):
  seed reproduction from hash, ink recolor without reseeding, sheet
  develop + double-click promote, five-file master export, paper proof.
- Engine transplanted with identical seeded draw order; unit test
  "the same seed always develops the identical figure" guards it.

## Verification

- Run: npm run verify:final passed for first product delivery
  (typecheck, docs/integrity checks, unit suite, build, browser
  acceptance).
- Run: browser performance checkpoint passed with agent-browser
  (Claude Code controlled Chrome via chrome-devtools MCP, 2026-07-13):
  develop-stress silk seed ce14a048 at the 2400px cap measured max
  frame gap 62ms and max long task 55ms over 180 frames; 4x4 sheet
  115ms/110ms; view toggle 52ms — all inside the 120ms/250ms/500ms
  budgets. The Playwright `browser perf:` suite in
  e2e/app-product-perf.spec.ts is the CI fallback via npm run
  verify:perf.

## Risks

- Risk: PNG exports above the 2880px develop cap upscale the composite
  (4K/8K dimensions are real, fine detail tops out at the cap). The
  2400px print masters remain pixel-exact; revisit with a worker-based
  develop if 8K fidelity ever matters.
- Risk: develop runs on the main thread (chunked). A Web Worker +
  OffscreenCanvas port would free the main thread entirely; not needed
  to meet current budgets.
- Risk: film grain is intentionally non-deterministic between develops
  of the same seed; acceptance snapshots compare structure via recipe
  identity, not pixel equality.
