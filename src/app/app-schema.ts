import { defineToolcraft } from "@/toolcraft/runtime";

import { MAX_INKS } from "./oscillon-engine";

/*
  Oscillon — a personal design tool that generates simulated
  oscilloscope long exposures (after Ben Laposky) destined for
  risograph prints on white paper.

  Recipe identity lives in runtime values: exposure.seed (single) or
  sheet.seeds (contact sheet), plus inks.drums. The URL hash mirrors
  the recipe so pieces stay shareable; see oscillon-renderer.tsx.
*/

export const appSchema = defineToolcraft({
  canvas: {
    // fixed workspace: the exposure sits fitted and centered — no
    // infinite-canvas panning; the renderer enforces fit-to-viewport
    draggable: false,
    enabled: true,
    renderScale: true,
    size: { height: 1200, unit: "px", width: 1200 },
    sizing: { mode: "editable-output" },
    upload: false,
  },
  panels: {
    controls: {
      sections: [
        {
          controls: {
            character: {
              defaultValue: "any",
              description:
                "Constrains what the next exposure rolls: ghost veils, fused silk membranes, or the dense fabric look.",
              label: "Character",
              options: [
                { label: "any", value: "any" },
                { label: "ghost", value: "ghost" },
                { label: "silk", value: "silk" },
                { label: "dense", value: "dense" },
              ],
              orderRole: "mode",
              performanceReason:
                "Setting a character filter is instant; the redevelop happens later when Generate commits a new seed (covered by the seed workload scenario).",
              performanceRole: "responsiveness",
              target: "exposure.character",
              type: "segmented",
            },
            figure: {
              defaultValue: "any",
              description:
                "Constrains the instrument mode of the next exposure.",
              label: "Figure",
              options: [
                { label: "Any", value: "any" },
                { label: "AM carrier", value: "am" },
                { label: "Lissajous", value: "liss" },
                { label: "Swept", value: "sweep" },
                { label: "Damped spiral", value: "spiral" },
              ],
              orderRole: "mode",
              performanceReason:
                "Setting a figure filter is instant; the redevelop happens later when Generate commits a new seed (covered by the seed workload scenario).",
              performanceRole: "responsiveness",
              target: "exposure.figure",
              type: "select",
            },
            seed: {
              commitMode: "setting",
              defaultValue: "",
              description:
                "Hex recipe seed. The same seed always redevelops the identical figure; paste one to reload a piece.",
              label: "Seed",
              orderRole: "detail",
              performanceReason:
                "Committing a seed redevelops the full exposure.",
              performanceRole: "workload",
              target: "exposure.seed",
              type: "text",
            },
          },
          title: "Exposure",
        },
        {
          controls: {
            grid: {
              defaultValue: "1",
              description:
                "Develop one exposure or a contact sheet of seeds at once. Double-click a sheet cell to develop it full size.",
              label: "Grid",
              options: [
                { label: "single", value: "1" },
                { label: "2×2", value: "2" },
                { label: "4×4", value: "4" },
              ],
              orderRole: "mode",
              performanceReason:
                "Sheet mode develops up to 16 exposures concurrently.",
              performanceRole: "workload",
              target: "sheet.grid",
              type: "segmented",
            },
          },
          title: "Contact sheet",
        },
        {
          controls: {
            drums: {
              defaultValue: [],
              description:
                "Risolve color-wheel inks in drum order. Selecting inks recolors the current figure; print masters become one separation per drum.",
              label: false,
              orderRole: "color",
              performanceReason:
                "Changing the ink set redevelops the exposure with new filter-wheel bands.",
              performanceRole: "workload",
              target: "inks.drums",
              type: "inkDrums",
            },
            inkActions: {
              actions: [
                { icon: "shuffle", label: "Combo", value: "ink-combo" },
                { icon: "eraser", label: "Clear", value: "ink-clear" },
              ],
              label: `Pick up to ${MAX_INKS} in drum order`,
              orderRole: "action",
              performanceReason:
                "Combo/Clear only rewrite the drum selection; the resulting redevelop is the inks.drums workload scenario's path.",
              performanceRole: "responsiveness",
              target: "inks.actions",
              type: "actions",
            },
          },
          title: "Inks",
        },
        {
          controls: {
            mode: {
              defaultValue: "paper",
              description:
                "Paper simulates the risograph print: translucent ink layers multiplied over the paper color with loose registration. Phosphor is the emissive scope view.",
              label: "Mode",
              options: [
                { label: "paper", value: "paper" },
                { label: "phosphor", value: "phosphor" },
              ],
              orderRole: "mode",
              performanceReason:
                "Switching view recomposites the developed buffers without redeveloping.",
              performanceRole: "responsiveness",
              target: "view.mode",
              type: "segmented",
            },
          },
          title: "View",
        },
        {
          controls: {
            include: {
              defaultValue: true,
              label: "Include",
              orderRole: "mode",
              performanceReason:
                "Toggling background visibility recomposites without redeveloping.",
              performanceRole: "responsiveness",
              target: "export.includeBackground",
              type: "switch",
            },
            background: {
              defaultValue: "#faf8f3",
              label: false,
              orderRole: "color",
              performanceReason:
                "Background recomposites the current buffers without redeveloping.",
              performanceRole: "responsiveness",
              target: "appearance.background",
              type: "color",
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["include", "background"],
              layout: "inline",
            },
          ],
          title: "Background",
        },
        {
          controls: {
            format: {
              defaultValue: "png",
              label: "Format",
              performanceReason:
                "Format changes export encoding only; the preview never re-renders.",
              performanceRole: "responsiveness",
              options: [
                { label: "PNG", value: "png" },
                { label: "JPG", value: "jpg" },
              ],
              orderRole: "mode",
              target: "export.image.format",
              type: "select",
            },
            resolution: {
              defaultValue: "4k",
              label: "Resolution",
              performanceReason:
                "Resolution selects the offline export develop size, which multiplies export work; the preview never re-renders.",
              performanceRole: "workload",
              options: [
                { label: "2K", value: "2k" },
                { label: "4K", value: "4k" },
                { label: "8K", value: "8k" },
              ],
              orderRole: "mode",
              target: "export.image.resolution",
              type: "select",
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["format", "resolution"],
              layout: "inline",
            },
          ],
          title: "Image Export",
        },
        {
          actionGroup: "primary",
          controls: {
            deliver: {
              actions: [
                { icon: "wand-sparkles", label: "Generate", value: "generate" },
                {
                  icon: "upload-simple",
                  label: "Export PNG",
                  value: "export-png",
                },
                {
                  icon: "upload-simple",
                  label: "Print Masters",
                  value: "export-masters",
                },
              ],
              orderRole: "action",
              target: "panel.actions",
              type: "panelActions",
            },
          },
        },
      ],
      title: "Oscillon",
    },
  },
  persistence: {
    include: ["values", "canvas", "panels"],
    key: "toolcraft:oscillion:state:v1",
    storage: "localStorage",
    version: 1,
  },
  settingsTransfer: "auto",
  toolbar: {
    history: true,
    radar: false,
    theme: true,
    zoom: false,
  },
});
