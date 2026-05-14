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

// Match PlaybackDialog reveal animation durations exactly so export looks
// identical to the in-app preview.
const TEXT_REVEAL_MS = 150;
const BLOCK_REVEAL_MS = 350;

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

/**
 * Reveal time for an element. Mirrors `PlaybackDialog` exactly:
 *   • Elements NOT bound to a spoken word reveal at scene start (t=0),
 *     so they animate in together with the scene fade-in.
 *   • Word-bound elements reveal at the audible-time offset of that word.
 *   • If a word-bound element's word never fires, fall back near the end
 *     so it still appears (matches the "leftover" pass in PlaybackDialog).
 */
function elementRevealMs(scene: ExportSceneData, el: ExportElement): number {
  const timings = scene.word_timings ?? [];
  const startWordIndex = (el.content as AnimationBlockContent & { start_word_index?: number | null }).start_word_index;

  const boundWord = el.content.word ? normalizeWord(el.content.word) : "";

  // No word binding → reveal at scene start (matches preview's autoReveal set).
  if (!boundWord && (typeof startWordIndex !== "number" || !timings[startWordIndex])) {
    return 0;
  }

  if (typeof startWordIndex === "number" && timings[startWordIndex]) {
    return audibleOffsetMs(scene, timings[startWordIndex].start_ms) ?? timings[startWordIndex].start_ms;
  }

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
    // Word-bound but its word never fires → reveal near the end (preview does the same).
    return Math.max(0, (scene.duration_ms ?? 0) - 800);
  }

  return 0;
}

/**
 * Off-screen render of a single scene at the canonical design resolution
 * (DESIGN.w × DESIGN.h). The exporter scales/snapshots this DOM. We never
 * mount this visibly in the editor — `position: fixed` + far off-screen.
 *
 * In export mode we DO NOT use CSS transitions: those animate on wall-clock
 * time, but the deterministic exporter advances virtual time per frame,
 * which would produce wrong-speed (or skipped) reveal animations. Instead
 * we compute opacity/scale ourselves from `currentMs` so each frame is
 * fully deterministic and matches the editor's preview speed exactly.
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
      <BackgroundLayer background={scene.background} exportMode={false} />
      {scene.elements
        .slice()
        .sort((a, b) => a.z_index - b.z_index)
        .map((el) => {
          const isText = el.type === "text" || typeof el.content.text === "string" || !!el.content.role;
          const revealMs = elementRevealMs(scene, el);
          const since = currentMs - revealMs;
          const revealDur = isText ? TEXT_REVEAL_MS : BLOCK_REVEAL_MS;

          // Deterministic eased progress 0..1 for the reveal animation.
          const rawT = !isPlaying ? 1 : Math.max(0, Math.min(1, since / revealDur));
          const t = rawT < 1 ? 1 - Math.pow(1 - rawT, 3) : 1; // ease-out cubic ≈ "ease"

          const opacity = !isPlaying ? 1 : (since < 0 ? 0 : t);
          const scale = isText ? 1 : 0.92 + 0.08 * (since < 0 ? 0 : t);
          const visible = opacity > 0;

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
                opacity,
                transform: !isText ? `scale(${scale})` : undefined,
                transformOrigin: "center center",
                // No CSS transition in exportMode — exporter drives every frame
                // via `currentMs`, so the in-app preview path keeps a small
                // transition for smoothness when the same component is used
                // outside the exporter.
                transition: exportMode
                  ? "none"
                  : isText
                    ? "opacity 150ms ease"
                    : "opacity 350ms ease, transform 350ms ease",
                overflow: "hidden",
              }}
            >
              {isText ? (
                <TextBlockRenderer
                  key={`${el.id}-${visible ? "visible" : "hidden"}`}
                  content={el.content}
                  // In export mode, suppress per-letter CSS animations because
                  // they're wall-clock based; show the final text deterministically.
                  animating={exportMode ? false : isPlaying && visible}
                />
              ) : (
                visible ? <AnimationBlockRenderer content={el.content} exportMode={false} /> : null
              )}
            </div>
          );
        })}
    </div>
  );
});
