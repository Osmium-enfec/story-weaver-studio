import { forwardRef } from "react";
import { AnimationBlockRenderer, TextBlockRenderer, type AnimationBlockContent } from "@/components/AnimationBlock";
import { BackgroundLayer } from "@/components/BackgroundPicker";
import { DESIGN } from "@/lib/grid";
import type { SceneBackground } from "@/lib/firebase-theme";

export interface ExportElement {
  id: string;
  type: string;
  content: AnimationBlockContent;
  position: { x: number; y: number; w: number; h: number };
  z_index: number;
}

export interface ExportSceneData {
  id: string;
  background: SceneBackground;
  elements: ExportElement[];
}

/**
 * Off-screen render of a single scene at the canonical design resolution
 * (DESIGN.w × DESIGN.h). The exporter scales/snapshots this DOM. We never
 * mount this visibly in the editor — `position: fixed` + far off-screen.
 */
export const ExportSceneStage = forwardRef<HTMLDivElement, {
  scene: ExportSceneData;
  isPlaying: boolean;
  exportMode?: boolean;
}>(function ExportSceneStage({ scene, isPlaying, exportMode = false }, ref) {
  return (
    <div
      ref={ref}
      style={{
        width: DESIGN.w,
        height: DESIGN.h,
        position: "relative",
        overflow: "hidden",
        background: "#ffffff",
      }}
    >
      <BackgroundLayer background={scene.background} exportMode={exportMode} />
      {scene.elements
        .slice()
        .sort((a, b) => a.z_index - b.z_index)
        .map((el) => (
          <div
            key={el.id}
            style={{
              position: "absolute",
              left: el.position.x,
              top: el.position.y,
              width: el.position.w,
              height: el.position.h,
            }}
          >
            {el.type === "text" ? (
              <TextBlockRenderer content={el.content} animating={isPlaying} />
            ) : (
              <AnimationBlockRenderer content={el.content} exportMode={exportMode} />
            )}
          </div>
        ))}
    </div>
  );
});
