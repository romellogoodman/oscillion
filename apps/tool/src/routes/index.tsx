import { ToolcraftApp } from "@/toolcraft/runtime/react";

import { handlePanelAction } from "../app/app-actions";
import { appSchema } from "../app/app-schema";
import { InkDrumsControl } from "../app/ink-drums-control";
import { OscillonRenderer } from "../app/oscillon-renderer";

const controlRenderers = {
  inkDrums: InkDrumsControl,
};

export function AppHome(): React.JSX.Element {
  return (
    <ToolcraftApp
      canvasContent={<OscillonRenderer />}
      className="h-dvh min-h-dvh"
      controlRenderers={controlRenderers}
      onPanelAction={handlePanelAction}
      renderDefaultCanvasMedia={false}
      schema={appSchema}
    />
  );
}
