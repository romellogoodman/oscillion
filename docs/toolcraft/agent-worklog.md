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

### Iteration 2 — Fixed workspace (remove the infinite canvas)

- Request: "can we remove the infinite canvas?"
- Task type: canvas/runtime feature (Tier 3).
- User-visible result: the exposure sits fitted and centered; no
  pan/zoom world. Drag and wheel attempts are inert; runtime Setup
  still owns canvas size and resolution scale.
- Source/reference checked: canvas-shell.tsx wheel/pointer handlers
  (wheel pan/zoom is not gated by canvas.draggable).
- Reference inputs: None.
- Docs/contracts read: core/runtime-boundary.md, assembly-workflow.md,
  decision-contract rule ids (routed for canvas behavior).
- Contract rules applied: runtime-shell-required, canvas-surface-
  preserved, performance-coverage-levels.
- Decision: schema canvas.draggable false + toolbar radar/zoom off; the
  renderer enforces fit-to-viewport via canvas.setViewport (ResizeObserver
  on the shell viewport) and swallows wheel events at window capture so
  no transient zoom frame is ever rasterized.
- Alternatives rejected: patching the runtime shell (forbidden);
  enforcer-only without wheel interception (a transient zoom frame
  forced a full software re-raster of the 2400px canvas).
- State/output mapping: canvas.zoom/offset are runtime state snapped to
  the fitted values; product output unchanged.
- Files changed: src/app/app-schema.ts, src/app/oscillon-renderer.tsx,
  src/app/app-performance.ts, e2e/app-product-perf.spec.ts,
  src/app/app-schema.test.ts, src/app/app-acceptance.ts.
- Verification: npm run test (239), npm run test:browser (31 passed),
  targeted perf serial runs; agent-browser measurements (below).
- Skipped checks: full performance suite not re-gated (post-first-working
  canvas edit; targeted scenarios measured — see Performance evidence).
- Risks: zoom clamp floor 25% means canvases larger than ~4x the
  viewport still crop slightly.

### Iteration 3 — Renderer perf hardening + headless CLI

- Request: perf budget failures under the Playwright fallback; then
  "can we make a command line that renders the oscillon in a scriptable
  way … aspect ratio of the canvas and everything?" and "can the cli
  also render a grid? i want a grid 8.5 x 11 page".
- Task type: renderer optimization (Tier 3) + repo tooling (CLI).
- User-visible result: smoother develops (staged buffer allocation via
  a time-budgeted build queue; incremental composites — sheets refresh
  one cell per tick, singles one quadrant; progress proofs capped at
  600px with a full-quality final pass). New `npm run render` CLI:
  seeds/random+filters, inks by name or index, paper/phosphor views,
  arbitrary size/aspect, print-set masters, and `--grid CxR` contact
  sheet pages with per-cell seed logs.
- Source/reference checked: performance traces + longtask attribution
  in the agent browser (mapper alpha-prefill and full-page proof
  rewrites were the long tasks).
- Reference inputs: None.
- Docs/contracts read: core/performance.md, performance.md,
  renderer-technique.md (coalescing non-essential preview work during
  interaction is sanctioned).
- Contract rules applied: performance-coverage-levels,
  renderer-technique-inventory.
- Decision: pure raster module (src/app/oscillon-raster.ts, DOM-free)
  shared by the CLI; CLI encodes PNG with node:zlib (no native deps)
  and runs on Node's native type-stripping.
- Alternatives rejected: node-canvas (native dependency); worker-based
  develop (not needed to meet budgets).
- State/output mapping: CLI mirrors the app exactly — same engine, same
  recipes; the h2/stip rng draw order was restored to the reference
  order after the CLI exposed a port regression (seed 0cb09815 rendered
  +5f instead of the reference +3f).
- Files changed: src/app/oscillon-engine.ts, src/app/oscillon-raster.ts,
  src/app/oscillon-renderer.tsx, scripts/oscillon-render.ts,
  package.json, tsconfig.json (allowImportingTsExtensions).
- Verification: npm run test (239), npm run test:browser (31 passed),
  CLI smoke renders (single paper/phosphor, 4:5 aspect, 4x6 letter-page
  grid, masters set), seed 0cb09815 caption parity with the reference.
- Skipped checks: full Playwright performance suite retained as CI
  fallback; a few scenarios are margin-flaky under headless software
  rasterization (see Performance evidence) while clean on the preferred
  agent-browser runner.
- Risks: CLI --develop-size above ~4096 allocates multi-hundred-MB
  buffers; documented in --help.

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
  115ms/110ms; view toggle 52ms; after the fixed-workspace pass the
  render-scale change measured 9ms max frame gap with zero long tasks
  and the 4x4 rebuild produced zero long tasks — all inside the
  120ms/250ms/500ms budgets on the preferred runner.
- Note: under the Playwright software-rasterization fallback a few
  responsiveness scenarios sit at the frame-gap margin and flip with
  machine load; the preferred agent-browser runner is clean on every
  scenario. The fallback suite (npm run verify:perf) remains the CI
  gate and the touched-path scenarios pass serially.

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
