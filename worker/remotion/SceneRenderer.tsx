import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
} from "remotion";
import { TextElement } from "./elements/TextElement.js";
import { LottieElement } from "./elements/LottieElement.js";
import { VideoElement } from "./elements/VideoElement.js";
import { ImageElement } from "./elements/ImageElement.js";
import { ShapeElement } from "./elements/ShapeElement.js";

const TEXT_REVEAL_FRAMES = 5; // ~150ms @ 30fps
const BLOCK_REVEAL_FRAMES = 11; // ~350ms @ 30fps

function normalizeWord(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function audibleOffsetMs(scene: any, wordStartMs: number): number | null {
  const trimStart = Math.max(0, scene.voice_trim_start_ms ?? 0);
  const trimEnd =
    scene.voice_trim_end_ms ?? scene.duration_ms ?? Number.POSITIVE_INFINITY;
  if (wordStartMs < trimStart || wordStartMs > trimEnd) return null;
  const cuts = (scene.voice_cuts ?? []).filter(
    (c: any) => c.end_ms > trimStart && c.start_ms < trimEnd,
  );
  if (
    cuts.some(
      (c: any) => wordStartMs >= c.start_ms && wordStartMs <= c.end_ms,
    )
  )
    return null;
  let elapsed = 0;
  let cursor = trimStart;
  for (const cut of [...cuts].sort(
    (a: any, b: any) => a.start_ms - b.start_ms,
  )) {
    const a = Math.max(cut.start_ms, trimStart);
    const b = Math.min(cut.end_ms, trimEnd);
    if (wordStartMs < a) return elapsed + Math.max(0, wordStartMs - cursor);
    elapsed += Math.max(0, a - cursor);
    cursor = Math.max(cursor, b);
  }
  return elapsed + Math.max(0, wordStartMs - cursor);
}

function elementRevealMs(scene: any, el: any): number {
  const timings = scene.word_timings ?? [];
  const swi = el.content?.start_word_index;
  const word = el.content?.word ? normalizeWord(el.content.word) : "";
  if (!word && (typeof swi !== "number" || !timings[swi])) return 0;
  if (typeof swi === "number" && timings[swi]) {
    return (
      audibleOffsetMs(scene, timings[swi].start_ms) ??
      timings[swi].start_ms
    );
  }
  if (word) {
    const occ = Math.max(1, el.content.occurrence ?? 1);
    let seen = 0;
    for (const t of timings) {
      if (normalizeWord(t.text) !== word) continue;
      if (++seen === occ)
        return audibleOffsetMs(scene, t.start_ms) ?? t.start_ms;
    }
    return Math.max(0, (scene.duration_ms ?? 0) - 800);
  }
  return 0;
}

export const SceneRenderer: React.FC<{ scene: any }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Background
  let background = "#ffffff";
  if (scene.background?.type === "color" && scene.background.value) {
    background = scene.background.value;
  } else if (
    scene.background?.type === "gradient" &&
    typeof scene.background.value === "string"
  ) {
    background = scene.background.value;
  }

  const sortedEls = [...(scene.scene_elements ?? scene.elements ?? [])].sort(
    (a: any, b: any) => (a.z_index ?? 0) - (b.z_index ?? 0),
  );

  return (
    <AbsoluteFill style={{ background }}>
      {/* Background image, if any */}
      {scene.background?.type === "image" && scene.background.value && (
        <img
          src={scene.background.value}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}

      {sortedEls.map((el: any) => {
        const isText =
          el.type === "text" ||
          typeof el.content?.text === "string" ||
          !!el.content?.role;
        const revealMs = elementRevealMs(scene, el);
        const revealFrame = Math.round((revealMs / 1000) * fps);
        const dur = isText ? TEXT_REVEAL_FRAMES : BLOCK_REVEAL_FRAMES;

        if (frame < revealFrame) return null;

        const opacity = interpolate(
          frame,
          [revealFrame, revealFrame + dur],
          [0, 1],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          },
        );
        const scale = isText
          ? 1
          : interpolate(
              frame,
              [revealFrame, revealFrame + dur],
              [0.92, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              },
            );

        const style: React.CSSProperties = {
          position: "absolute",
          left: el.position?.x ?? 0,
          top: el.position?.y ?? 0,
          width: el.position?.w ?? 100,
          height: el.position?.h ?? 100,
          zIndex: el.z_index ?? 0,
          opacity,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          overflow: "hidden",
        };

        const sinceMs = ((frame - revealFrame) / fps) * 1000;
        const localFrame = frame - revealFrame;

        if (isText) return <TextElement key={el.id} el={el} style={style} />;

        const c = el.content ?? {};
        const lottieSrc =
          c.lottie_url ||
          c.dotlottie_url ||
          (c.preview_url && /\.(json|lottie)(\?|$)/i.test(c.preview_url)
            ? c.preview_url
            : null);
        if ((el.type === "animation" || el.type === "lottie") && lottieSrc) {
          return (
            <LottieElement
              key={el.id}
              el={el}
              style={style}
              lottieSrc={lottieSrc}
              localFrame={localFrame}
            />
          );
        }

        const videoSrc =
          c.video_url ||
          (c.preview_url && /\.(mp4|webm|mov)(\?|$)/i.test(c.preview_url)
            ? c.preview_url
            : null);
        if (videoSrc) {
          return (
            <VideoElement
              key={el.id}
              el={el}
              style={style}
              src={videoSrc}
              startMs={sinceMs}
            />
          );
        }

        const imageSrc =
          c.image_url ||
          c.url ||
          c.preview_url ||
          c.thumbnail_url ||
          c.svg_url;
        if (imageSrc) {
          return (
            <ImageElement key={el.id} el={el} style={style} src={imageSrc} />
          );
        }

        if (c.shape_type)
          return <ShapeElement key={el.id} el={el} style={style} />;

        return null;
      })}
    </AbsoluteFill>
  );
};
