import { describe, expect, it } from "vitest";

import { appPerformance } from "./app-performance";
import { appSchema } from "./app-schema";

describe("appSchema", () => {
  it("publishes the Oscillon product contract on the Toolcraft shell", () => {
    expect(appSchema.canvas.enabled).toBe(true);
    expect(appSchema.canvas.sizing).toEqual({ mode: "editable-output" });
    expect(appSchema.canvas.upload).toBe(false);
    expect(appSchema.canvas.size).toEqual({
      height: 1200,
      unit: "px",
      width: 1200,
    });
    expect(appSchema.panels.controls?.sections[0]?.title).toBe("Setup");
    expect(
      appSchema.panels.controls?.sections[0]?.controls.settingsTransfer,
    ).toMatchObject({
      target: "runtime.settingsTransfer",
      type: "settingsTransfer",
    });
    expect(appSchema.panels.layers).toBeUndefined();
    expect(appSchema.panels.timeline).toBeUndefined();
    expect(appSchema.toolbar).toEqual({
      history: true,
      radar: true,
      theme: true,
      zoom: true,
    });
  });

  it("groups product controls by workflow stage", () => {
    const titles = (appSchema.panels.controls?.sections ?? [])
      .map((section) => section.title)
      .filter(Boolean);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Exposure",
        "Contact sheet",
        "Inks",
        "View",
        "Background",
        "Image Export",
      ]),
    );
  });

  it("does not imply timeline behavior for a still product", () => {
    expect(appSchema.assembly.capabilities).not.toContain("timeline.playback");
    expect(appSchema.assembly.capabilities).not.toContain(
      "timeline.keyframes",
    );
  });

  it("declares the custom renderer performance matrix", () => {
    expect(appPerformance.usesCustomRenderer).toBe(true);
    expect(appPerformance.rendererStrategy).toBe("canvas-2d");
    expect(appPerformance.scenarios.length).toBeGreaterThanOrEqual(5);
    expect(appPerformance.workloadTargets).toContain("exposure.seed");
  });
});
