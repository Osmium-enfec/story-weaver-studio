import { forwardRef } from "react";
import { AnimationBlockRenderer, TextBlockRenderer, type AnimationBlockContent } from "@/components/AnimationBlock";
import { BackgroundLayer } from "@/components/BackgroundPicker";
import { DESIGN } from "@/lib/grid";
import type { SceneBackground } from "@/components/BackgroundPicker";

export interface ExportElement {
  id: string;
  type: string;
  content: AnimationBlockContent;
  position: { x: number; y: number; w: number; h: number };
  start_ms?: number | null;
  end_ms?: number | null;
  z_index: number;
}

export interface ExportSceneData {
  id: string;
  background: SceneBackground;
  elements: ExportElement[];
  duration_ms?: number;
  word_timings?: { text: string; start_ms: number; end_ms: number }[];
  voice_trim_start_ms?: number;
  voice_trim_end_ms?: number | null;
  voice_cuts?: { start_ms: number; end_ms: number }[];
}

function normalizeWord(word: string) {
  return word.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function audibleOffsetMs(scene: ExportSceneData, wordStartMs: number): number | null {
  const trimStart = Math.max(0, scene.voice_trim_start_ms ?? 0);
  const trimEnd = scene.voice_trim_end_ms ?? scene.duration_ms ?? Number.POSITIVE_INFINITY;
  if (wordStartMs < trimStart || wordStartMs > trimEnd) return null;
  const cuts = (scene.voice_cuts ?? []).filter((c) => c.end_ms > trimStart && c.start_ms < trimEnd);
  if (cuts.some((c) => wordStartMs >= c.start_ms && wordStartMs <= c.end_ms)) return null;
  let elapsed = 0;
  let cursor = trimStart;
  for (const cut of cuts.sort((a, b) => a.start_ms - b.start_ms)) {
    const a = Math.max(cut.start_ms, trimStart);
    const b = Math.min(cut.end_ms, trimEnd);
    if (wordStartMs < a) return elapsed + Math.max(0, wordStartMs - cursor);
    elapsed += Math.max(0, a - cursor);
    cursor = Math.max(cursor, b);
  }
  return elapsed + Math.max(0, wordStartMs - cursor);
}

function elementRevealMs(scene: ExportSceneData, el: ExportElement): number {
  const timings = scene.word_timings ?? [];
  const startWordIndex = (el.content as AnimationBlockContent & { start_word_index?: number | null }).start_word_index;
  if (typeof startWordIndex === "number" && timings[startWordIndex]) {
    return audibleOffsetMs(scene, timings[startWordIndex].start_ms) ?? timings[startWordIndex].start_ms;
  }

  const boundWord = el.content.word ? normalizeWord(el.content.word) : "";
  if (boundWord) {
    const occurrence = Math.max(1, el.content.occurrence ?? 1);
    let seen = 0;
    for (const timing of timings) {
      if (normalizeWord(timing.text) !== boundWord) continue;
      seen += 1;
      if (seen === occurrence) {
        return audibleOffsetMs(scene, timing.start_ms) ?? timing.start_ms;
      }
    }
  }

  if (typeof el.start_ms === "number" && el.start_ms > 0) return el.start_ms;
  if (boundWord) return Math.max(0, (scene.duration_ms ?? 0) - 800);
  return 0;
}

/**
 * Off-screen render of a single scene at the canonical design resolution
 * (DESIGN.w × DESIGN.h). The exporter scales/snapshots this DOM. We never
 * mount this visibly in the editor — `position: fixed` + far off-screen.
 */
export const ExportSceneStage = forwardRef<HTMLDivElement, {
  scene: ExportSceneData;
  isPlaying: boolean;
  currentMs?: number;
  exportMode?: boolean;
}>(function ExportSceneStage({ scene, isPlaying, currentMs = 0, exportMode = false }, ref) {
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
        .map((el) => {
          const isText = el.type === "text" || typeof el.content.text === "string" || !!el.content.role;
          const visible = !isPlaying || currentMs >= elementRevealMs(scene, el);
          return (
            <div
              key={el.id}
              style={{
                position: "absolute",
                left: el.position.x,
                top: el.position.y,
                width: el.position.w,
                height: el.position.h,
                zIndex: el.z_index,
                opacity: visible ? 1 : 0,
                transform: visible && !isText ? "scale(1)" : !isText ? "scale(0.92)" : undefined,
                transition: isText ? "opacity 150ms ease" : "opacity 350ms ease, transform 350ms ease",
                overflow: "hidden",
              }}
            >
              {isText ? (
                <TextBlockRenderer
                  key={`${el.id}-${visible ? "visible" : "hidden"}`}
                  content={el.content}
                  animating={isPlaying && visible}
                />
              ) : (
                <AnimationBlockRenderer content={el.content} exportMode={exportMode} />
              )}
            </div>
          );
        })}
    </div>
  );
});
