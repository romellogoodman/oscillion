import { expect, test, type Page } from "@playwright/test";

import { appPerformance } from "../src/app/app-performance";
import {
  dragToolcraftCanvasViewport,
  dragToolcraftSliderByLabel,
  expectToolcraftCanvasViewportStable,
  expectToolcraftScenarioPerformanceBudget,
  getToolcraftFieldByLabel,
  getToolcraftPerformanceStressValue,
  measureToolcraftAnimationFrames,
  measureToolcraftInteraction,
} from "./performance-helpers";

const PRODUCT_CANVAS = '[data-testid="oscillon-product-canvas"]';

async function gotoFresh(page: Page, url = "/"): Promise<void> {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(url);
  await expect(page.locator(PRODUCT_CANVAS)).toBeVisible();
}

async function commitSeed(page: Page, seed: string): Promise<void> {
  const field = await getToolcraftFieldByLabel(page, "Seed");
  const input = field.locator("input");
  await input.fill(seed);
  await input.press("Enter");
}

test("browser perf: committing a seed develops without blocking frames", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page);
  await page.waitForTimeout(1500);
  const stressSeed = getToolcraftPerformanceStressValue<string>(
    appPerformance,
    "develop-workload",
  );
  await commitSeed(page, stressSeed);
  // sample frames while the heaviest silk develop runs at the size cap
  const result = await measureToolcraftAnimationFrames(page, 180);
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "develop-workload",
  );
});

test("browser perf: max develop stress keeps frames presenting", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page);
  await page.waitForTimeout(1500);
  const stressSeed = getToolcraftPerformanceStressValue<string>(
    appPerformance,
    "develop-stress",
  );
  await commitSeed(page, stressSeed);
  const result = await measureToolcraftAnimationFrames(page, 180);
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "develop-stress",
  );
});

test("browser perf: character filter selection responds instantly", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page);
  await page.waitForTimeout(4500);
  const result = await measureToolcraftInteraction(page, async () => {
    await page.getByRole("button", { name: "silk", exact: true }).click();
  });
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "character-responsiveness",
  );
});

test("browser perf: figure filter selection responds instantly", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page);
  await page.waitForTimeout(4500);
  const figure = await getToolcraftFieldByLabel(page, "Figure");
  const result = await measureToolcraftInteraction(page, async () => {
    await figure.locator('[data-slot="select-trigger"]').first().click();
    await page
      .locator('[data-slot="select-item"]')
      .filter({ hasText: "Damped spiral" })
      .first()
      .click();
  });
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "figure-responsiveness",
  );
});

test("browser perf: choosing an export resolution responds instantly", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page);
  await page.waitForTimeout(4500);
  const stressResolution = getToolcraftPerformanceStressValue<string>(
    appPerformance,
    "resolution-change",
  );
  const resolution = page
    .locator('[data-slot="field"]')
    .filter({ hasText: /^Resolution/ })
    .filter({ hasNotText: "scale" })
    .first();
  const result = await measureToolcraftInteraction(page, async () => {
    await resolution.locator('[data-slot="select-trigger"]').first().click();
    await page
      .locator('[data-slot="select-item"]')
      .filter({ hasText: stressResolution.toUpperCase() })
      .first()
      .click();
  });
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "resolution-change",
  );
});

test("browser perf: zooming under a developing sheet stays within budget", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page);
  await page.getByRole("button", { name: "4×4" }).click();
  // let the cell rebuild settle; the scenario measures zoom attempts
  // over a developing sheet, not the allocation moment
  await page.waitForTimeout(1500);
  // the workspace is fixed: ctrl+wheel zoom attempts must snap back to
  // the fitted viewport while the develop keeps presenting frames
  const canvas = page.locator(PRODUCT_CANVAS);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("product canvas has no bounding box");
  const result = await expectToolcraftCanvasViewportStable(
    page,
    async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -240);
      await page.mouse.wheel(0, 240);
      await page.mouse.wheel(0, -240);
      await page.mouse.wheel(0, 240);
      await page.keyboard.up("Control");
    },
    { settleMs: 300 },
  );
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "zoom-stress",
  );
});

test("browser perf: a 4x4 sheet develops without blocking frames", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "4×4" }).click();
  const result = await measureToolcraftAnimationFrames(page, 180);
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "sheet-workload",
  );
});

test("browser perf: view mode responds without redeveloping", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page);
  // let the initial exposure develop fully so the toggle is a pure
  // recomposite of settled buffers
  await page.waitForTimeout(5000);
  const result = await measureToolcraftInteraction(page, async () => {
    await page.getByRole("button", { name: "phosphor" }).click();
  });
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "view-responsiveness",
  );
});

test("browser perf: canvas drag and zoom stay stable during develop", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page);
  await page.getByRole("button", { name: "4×4" }).click();
  // let the cell rebuild settle; drags are measured over a developing
  // sheet, not the allocation moment
  await page.waitForTimeout(1500);
  // drag attempts must leave the fixed workspace unmoved while the
  // sheet develops
  const result = await expectToolcraftCanvasViewportStable(
    page,
    async () => {
      await dragToolcraftCanvasViewport(page);
      await dragToolcraftCanvasViewport(page);
    },
    { settleMs: 400 },
  );
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "viewport-stability",
  );
});

test("browser perf: selecting four ink drums redevelops within budget", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page, "/#0cb09815");
  await page.waitForTimeout(4500);
  const stressDrums = getToolcraftPerformanceStressValue<number[]>(
    appPerformance,
    "inks-workload",
  );
  const drums = page.locator('[data-testid="oscillon-ink-drums"] button');
  const result = await measureToolcraftInteraction(page, async () => {
    for (const idx of stressDrums) {
      await drums.nth(idx).click();
    }
  });
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "inks-workload",
  );
});

test("browser perf: ink combo and clear respond within budget", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page, "/#0cb09815");
  await page.waitForTimeout(4500);
  const result = await measureToolcraftInteraction(page, async () => {
    await page.getByRole("button", { name: "Combo" }).click();
    await page.getByRole("button", { name: "Clear" }).click();
  });
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "ink-actions-responsiveness",
  );
});

test("browser perf: include background toggles without redeveloping", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page, "/#0cb09815");
  await page.waitForTimeout(5000);
  const result = await measureToolcraftInteraction(page, async () => {
    await page.getByRole("switch").first().click();
  });
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "include-background-responsiveness",
  );
});

test("browser perf: background color retints without redeveloping", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page, "/#0cb09815");
  await page.waitForTimeout(5000);
  const include = await getToolcraftFieldByLabel(page, "Include");
  const hexInput = include.locator('input[type="text"]').last();
  const result = await measureToolcraftInteraction(page, async () => {
    await hexInput.fill("#e8d5c0");
    await hexInput.press("Enter");
  });
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "background-responsiveness",
  );
});

test("browser perf: choosing an export format responds instantly", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page);
  await page.waitForTimeout(4500);
  const format = await getToolcraftFieldByLabel(page, "Format");
  const result = await measureToolcraftInteraction(page, async () => {
    await format.locator('[data-slot="select-trigger"]').first().click();
    await page
      .locator('[data-slot="select-item"]')
      .filter({ hasText: "JPG" })
      .first()
      .click();
  });
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "format-responsiveness",
  );
});

test("browser perf: dragging resolution scale stays responsive", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page);
  await page.waitForTimeout(2500);
  const result = await measureToolcraftInteraction(page, async () => {
    await dragToolcraftSliderByLabel(page, "Resolution scale", 1);
  });
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "render-scale-drag",
  );
});

test("browser perf: 2k png export completes within budget", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoFresh(page, "/#0cb09815");
  await page.waitForTimeout(4500);
  const resolution = await getToolcraftFieldByLabel(page, "Resolution");
  await resolution.getByRole("combobox").click();
  await page.getByRole("option", { name: "2K" }).click();
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  const result = await measureToolcraftInteraction(page, async () => {
    await page.getByRole("button", { name: "Export PNG" }).click();
    await downloadPromise;
  });
  expectToolcraftScenarioPerformanceBudget(
    result,
    appPerformance,
    "export-budget",
  );
});
