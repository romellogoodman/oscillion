import { readFileSync } from "node:fs";

import { expect, test, type Download, type Page } from "@playwright/test";

import {
  expectToolcraftCanvasBackingPixelsForRenderScale,
  expectToolcraftDiscreteSliderDragSmoothness,
  expectToolcraftSegmentedControlCellsPreservePadding,
  getToolcraftFieldByLabel,
} from "./performance-helpers";
import {
  expectToolcraftProductObservableToChange,
  getToolcraftProductObservableSnapshot,
} from "./product-observable-helpers";

const PRODUCT_CANVAS = '[data-testid="oscillon-product-canvas"]';
const KNOWN_SEED = "0cb09815";
const RECIPE_URL = `/#${KNOWN_SEED}/25,11`;

async function waitForDevelopSettled(page: Page, ms = 4500): Promise<void> {
  await page.waitForTimeout(ms);
}

async function gotoFresh(page: Page, url = "/"): Promise<void> {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(url);
  await expect(page.locator(PRODUCT_CANVAS)).toBeVisible();
}

async function chooseSelectOption(
  page: Page,
  fieldLabel: string,
  optionLabel: string,
): Promise<void> {
  const field =
    fieldLabel === "Resolution"
      ? page
          .locator('[data-slot="field"]')
          .filter({ hasText: /^Resolution/ })
          .filter({ hasNotText: "scale" })
          .first()
      : await getToolcraftFieldByLabel(page, fieldLabel);
  await field.locator('[data-slot="select-trigger"]').first().click();
  await page
    .locator('[data-slot="select-item"]')
    .filter({ hasText: optionLabel })
    .first()
    .click();
}

async function seedField(page: Page) {
  const field = await getToolcraftFieldByLabel(page, "Seed");
  return field.locator("input");
}

async function commitSeed(page: Page, seed: string): Promise<void> {
  const input = await seedField(page);
  await input.fill(seed);
  await input.press("Enter");
}

async function downloadFrom(
  page: Page,
  action: () => Promise<void>,
): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 90_000 }),
    action(),
  ]);
  return download;
}

test("browser: character filter changes what Generate develops", async ({
  page,
}) => {
  await gotoFresh(page);
  await waitForDevelopSettled(page);
  await expectToolcraftSegmentedControlCellsPreservePadding(page, "Character");
  // tap through every character option, settle on silk
  for (const option of ["ghost", "dense", "any", "silk"]) {
    const cell = page.getByRole("button", { name: option, exact: true });
    await cell.click();
    await expect(cell).toHaveAttribute("aria-pressed", "true");
  }
  await expectToolcraftProductObservableToChange(
    page,
    async () => {
      await page.getByRole("button", { name: "Generate" }).click();
      await page.waitForTimeout(2500);
    },
    { selector: PRODUCT_CANVAS, timeoutMs: 15_000 },
  );
  expect(page.url()).toMatch(/#[0-9a-f]{8}$/);
});

test("browser: figure filter changes what Generate develops", async ({
  page,
}) => {
  await gotoFresh(page);
  await waitForDevelopSettled(page);
  // tap through every figure option, settle on Damped spiral
  for (const option of [
    "AM carrier",
    "Lissajous",
    "Swept",
    "Any",
    "Damped spiral",
  ]) {
    await chooseSelectOption(page, "Figure", option);
  }
  await expectToolcraftProductObservableToChange(
    page,
    async () => {
      await page.getByRole("button", { name: "Generate" }).click();
      await page.waitForTimeout(2500);
    },
    { selector: PRODUCT_CANVAS, timeoutMs: 15_000 },
  );
});

test("browser: committing a seed redevelops that exact figure", async ({
  page,
}) => {
  await gotoFresh(page);
  await waitForDevelopSettled(page);
  await commitSeed(page, KNOWN_SEED);
  await waitForDevelopSettled(page);
  expect(page.url()).toContain(`#${KNOWN_SEED}`);
  const first = await getToolcraftProductObservableSnapshot(page, {
    selector: PRODUCT_CANVAS,
  });
  expect(first.length).toBeGreaterThan(0);
});

test("browser: grid develops a contact sheet and double-click promotes a cell", async ({
  page,
}) => {
  await gotoFresh(page);
  await waitForDevelopSettled(page, 2500);
  await expectToolcraftSegmentedControlCellsPreservePadding(page, "Grid");
  // touch every grid option: 4×4 first, then settle on 2×2
  await page.getByRole("button", { name: "4×4" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "single" }).click();
  await page.waitForTimeout(800);
  await expectToolcraftProductObservableToChange(
    page,
    async () => {
      await page.getByRole("button", { name: "2×2" }).click();
      await page.waitForTimeout(2500);
    },
    { selector: PRODUCT_CANVAS, timeoutMs: 15_000 },
  );
  await expect
    .poll(
      () => new URL(page.url()).hash.replace(/^#/, "").split("/")[0].split(",").length,
      { timeout: 10_000 },
    )
    .toBe(4);
  const sheetSeeds = new URL(page.url()).hash
    .replace(/^#/, "")
    .split("/")[0]
    .split(",");
  const canvas = page.locator(PRODUCT_CANVAS);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("product canvas has no bounding box");
  const side = Math.min(box.width, box.height);
  await canvas.dblclick({
    position: {
      x: (box.width - side) / 2 + side * 0.2,
      y: (box.height - side) / 2 + side * 0.2,
    },
  });
  await expect
    .poll(() => new URL(page.url()).hash.replace(/^#/, ""), {
      timeout: 10_000,
    })
    .toBe(sheetSeeds[0]);
});

test("browser: picking ink drums recolors the exposure", async ({ page }) => {
  await gotoFresh(page, `/#${KNOWN_SEED}`);
  await waitForDevelopSettled(page);
  const drums = page.locator('[data-testid="oscillon-ink-drums"] button');
  await expectToolcraftProductObservableToChange(
    page,
    async () => {
      await drums.nth(25).click();
      await drums.nth(11).click();
      await page.waitForTimeout(2500);
    },
    { selector: PRODUCT_CANVAS, timeoutMs: 15_000 },
  );
  expect(new URL(page.url()).hash).toBe(`#${KNOWN_SEED}/25,11`);
  await expect(drums.nth(25)).toHaveAttribute("data-selected", "true");
  await expect(drums.nth(11)).toHaveAttribute("data-selected", "true");
});

test("browser: ink combo and clear update the drum selection", async ({
  page,
}) => {
  await gotoFresh(page, `/#${KNOWN_SEED}`);
  await waitForDevelopSettled(page, 2500);
  await page.getByRole("button", { name: "Combo" }).click();
  await expect(
    page.locator('[data-testid="oscillon-ink-drums"] button[data-selected]'),
  ).toHaveCount(2);
  await expect
    .poll(() => new URL(page.url()).hash.includes("/"), { timeout: 5000 })
    .toBe(true);
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(
    page.locator('[data-testid="oscillon-ink-drums"] button[data-selected]'),
  ).toHaveCount(0);
});

test("browser: view mode flips between paper and phosphor", async ({
  page,
}) => {
  await gotoFresh(page, `/#${KNOWN_SEED}`);
  await waitForDevelopSettled(page);
  await expectToolcraftSegmentedControlCellsPreservePadding(page, "Mode");
  await expectToolcraftProductObservableToChange(
    page,
    async () => {
      await page.getByRole("button", { name: "phosphor" }).click();
      await page.waitForTimeout(600);
    },
    { selector: PRODUCT_CANVAS, timeoutMs: 10_000 },
  );
  await expectToolcraftProductObservableToChange(
    page,
    async () => {
      await page.getByRole("button", { name: "paper", exact: true }).click();
      await page.waitForTimeout(600);
    },
    { selector: PRODUCT_CANVAS, timeoutMs: 10_000 },
  );
});

test("browser: background color retints the paper", async ({ page }) => {
  await gotoFresh(page, `/#${KNOWN_SEED}`);
  await waitForDevelopSettled(page);
  const hexInput = page.locator('input[aria-label$=" hex"]').first();
  await expectToolcraftProductObservableToChange(
    page,
    async () => {
      await hexInput.fill("#e8d5c0");
      await hexInput.press("Enter");
      await page.waitForTimeout(600);
    },
    { selector: PRODUCT_CANVAS, timeoutMs: 10_000 },
  );
});

test("browser: include toggle hides the product background", async ({
  page,
}) => {
  await gotoFresh(page, `/#${KNOWN_SEED}`);
  await waitForDevelopSettled(page);
  await expectToolcraftProductObservableToChange(
    page,
    async () => {
      await page.getByRole("switch").first().click();
      await page.waitForTimeout(600);
    },
    { selector: PRODUCT_CANVAS, timeoutMs: 10_000 },
  );
});

test("browser: export png downloads the selected format", async ({ page }) => {
  test.setTimeout(180_000);
  await gotoFresh(page, `/#${KNOWN_SEED}`);
  await waitForDevelopSettled(page);
  await chooseSelectOption(page, "Resolution", "2K");
  await chooseSelectOption(page, "Format", "JPG");
  const download = await downloadFrom(page, async () => {
    await page.getByRole("button", { name: "Export PNG" }).click();
  });
  expect(download.suggestedFilename()).toMatch(/\.jpg$/);
  const filePath = await download.path();
  const bytes = readFileSync(filePath);
  expect(bytes[0]).toBe(0xff); // JPEG SOI marker
  expect(bytes[1]).toBe(0xd8);
});

test("browser: export resolution produces the selected long edge", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await gotoFresh(page, `/#${KNOWN_SEED}`);
  await waitForDevelopSettled(page);
  // touch every resolution option, settle on 2K for the real export
  for (const option of ["4K", "8K", "2K"]) {
    await chooseSelectOption(page, "Resolution", option);
  }
  const download = await downloadFrom(page, async () => {
    await page.getByRole("button", { name: "Export PNG" }).click();
  });
  const filePath = await download.path();
  // decode the exported image and assert real pixel dimensions for the
  // selected export.image.resolution (2K -> 2048 long edge)
  const bytes = readFileSync(filePath);
  const dims = await page.evaluate(async (b64) => {
    const blob = await (
      await fetch(`data:image/png;base64,${b64}`)
    ).blob();
    const png = await createImageBitmap(blob);
    return { height: png.height, width: png.width };
  }, bytes.toString("base64"));
  expect(Math.max(dims.width, dims.height)).toBe(2048);
});

test("browser: canvas size changes reshape the product output", async ({
  page,
}) => {
  await gotoFresh(page, `/#${KNOWN_SEED}`);
  await waitForDevelopSettled(page);
  const width = await getToolcraftFieldByLabel(page, "Canvas width");
  const input = width.locator("input");
  await expectToolcraftProductObservableToChange(
    page,
    async () => {
      await input.fill("1600");
      await input.press("Enter");
      await page.waitForTimeout(1500);
    },
    { selector: PRODUCT_CANVAS, timeoutMs: 15_000 },
  );
});

test("browser: generate rolls a new seed and masters export the print set", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await gotoFresh(page, RECIPE_URL);
  await waitForDevelopSettled(page);
  const hashBefore = new URL(page.url()).hash;
  await page.getByRole("button", { name: "Generate" }).click();
  await expect
    .poll(() => new URL(page.url()).hash, { timeout: 10_000 })
    .not.toBe(hashBefore);
  await waitForDevelopSettled(page);

  // restore the known recipe so master filenames are deterministic
  await commitSeed(page, KNOWN_SEED);
  await waitForDevelopSettled(page, 2500);

  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await page.getByRole("button", { name: "Print Masters" }).click();
  // composite + one master per drum (2 inks) + proof = 4 files
  await expect.poll(() => downloads.length, { timeout: 180_000 }).toBe(4);
  const names = downloads.map((d) => d.suggestedFilename());
  expect(names.some((n) => n.endsWith("-print.png"))).toBe(true);
  expect(names.some((n) => n.includes("-master-1-fluor-pink"))).toBe(true);
  expect(names.some((n) => n.includes("-master-2-light-teal"))).toBe(true);
  expect(names.some((n) => n.endsWith("-proof.png"))).toBe(true);
});

test("browser: a recipe URL restores seed and inks on load", async ({
  page,
}) => {
  await gotoFresh(page, RECIPE_URL);
  await waitForDevelopSettled(page, 2500);
  const input = await seedField(page);
  await expect(input).toHaveValue(KNOWN_SEED);
  await expect(
    page.locator('[data-testid="oscillon-ink-drums"] button[data-selected]'),
  ).toHaveCount(2);
  const snapshot = await getToolcraftProductObservableSnapshot(page, {
    selector: PRODUCT_CANVAS,
  });
  expect(snapshot.length).toBeGreaterThan(0);
});

test("browser: resolution scale doubles the backing pixels", async ({
  page,
}) => {
  await gotoFresh(page, `/#${KNOWN_SEED}`);
  await page.waitForTimeout(1500);
  await expectToolcraftCanvasBackingPixelsForRenderScale(
    page,
    PRODUCT_CANVAS,
    2,
  );
  const snapshot = await getToolcraftProductObservableSnapshot(page, {
    selector: PRODUCT_CANVAS,
  });
  expect(snapshot.length).toBeGreaterThan(0);
  // discrete slider assertions: variant, hover markers, drag smoothness
  const slider = page
    .locator('[data-slot="slider"][data-variant="discrete"]')
    .first();
  await expect(slider).toBeVisible();
  await slider.hover();
  await expect(
    page.locator('[data-slot="slider-marker"]').first(),
  ).toBeAttached();
  // dragging re-targets the develop buffer, so allow the redevelop kick-off
  await expectToolcraftDiscreteSliderDragSmoothness(page, "Resolution scale", {
    maxFrameGapMs: 400,
    maxInteractionMs: 5000,
  });
});

test("browser: settings survive a reload via localStorage", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(PRODUCT_CANVAS)).toBeVisible();
  await page.getByRole("button", { name: "phosphor" }).click();
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator(PRODUCT_CANVAS)).toBeVisible();
  await expect(page.getByRole("button", { name: "phosphor" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
