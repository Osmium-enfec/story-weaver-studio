import {
  AbsoluteFill,
  Html5Video,
  Img,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
  staticFile,
} from "remotion";
import { TextElement } from "./elements/TextElement";
import { LottieElement } from "./elements/LottieElement";
import { VideoElement } from "./elements/VideoElement";
import { ImageElement } from "./elements/ImageElement";
import { ShapeElement } from "./elements/ShapeElement";

const TEXT_REVEAL_FRAMES = 5; // ~150ms @ 30fps
const BLOCK_REVEAL_FRAMES = 11; // ~350ms @ 30fps

type TxType =
  | "fade" | "dissolve" | "slide-left" | "slide-right"
  | "slide-up" | "wipe" | "zoom" | "blur";

interface TxEntry { type: TxType; duration_ms: number }

function findTx(map: Record<string, TxEntry>, role: "from" | "to", elementId: string): TxEntry | null {
  if (!map) return null;
  for (const k of Object.keys(map)) {
    const [from, to] = k.split("__");
    if (role === "from" && from === elementId) return map[k];
    if (role === "to" && to === elementId) return map[k];
  }
  return null;
}

function txTransform(type: TxType, t: number, phase: "enter" | "exit") {
  // t = 0..1, where for "enter" 0=hidden→1=visible, for "exit" 1=visible→0=hidden
  const p = phase === "enter" ? t : 1 - t;
  let opacity = p;
  let translateX = 0, translateY = 0, scale = 1, blurPx = 0;
  switch (type) {
    case "fade":
    case "dissolve":
      break;
    case "slide-left":  translateX = (1 - p) * (phase === "enter" ? 60 : -60); break;
    case "slide-right": translateX = (1 - p) * (phase === "enter" ? -60 : 60); break;
    case "slide-up":    translateY = (1 - p) * (phase === "enter" ? 60 : -60); break;
    case "wipe":        translateX = (1 - p) * (phase === "enter" ? 80 : -80); opacity = p > 0.05 ? 1 : 0; break;
    case "zoom":        scale = 0.6 + 0.4 * p; break;
    case "blur":        blurPx = 14 * (1 - p); break;
  }
  return { opacity, translateX, translateY, scale, blurPx };
}

function normalizeWord(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function resolveAssetSrc(src?: string | null) {
  if (!src) return "";
  // The editor stores bundled/public assets as absolute paths such as
  // "/themes/firebase/bg-orange.svg". In Remotion these must be resolved
  // through staticFile() or Chromium requests the wrong origin and the
  // background silently disappears in the final render.
  if (src.startsWith("/") && !src.startsWith("//")) {
    return staticFile(src.replace(/^\/+/, ""));
  }
  return src;
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

// Design space the editor / element coordinates are authored in.
const DESIGN_W = 1280;
const DESIGN_H = 720;

export const SceneRenderer: React.FC<{ scene: any }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, width: outW, height: outH } = useVideoConfig();
  // Scale the 1280x720 design surface to the actual output (1920x1080, 4k, ...).
  // Use the smaller axis to letterbox if aspect ratios differ; for matching
  // 16:9 outputs both axes match so it just upscales cleanly.
  const scaleFit = Math.min(outW / DESIGN_W, outH / DESIGN_H);
  const stageW = DESIGN_W * scaleFit;
  const stageH = DESIGN_H * scaleFit;
  const offsetX = (outW - stageW) / 2;
  const offsetY = (outH - stageH) / 2;

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

  const backgroundSrc = resolveAssetSrc(scene.background?.value);

  const sortedEls = [...(scene.scene_elements ?? scene.elements ?? [])].sort(
    (a: any, b: any) => (a.z_index ?? 0) - (b.z_index ?? 0),
  );

  return (
    <AbsoluteFill style={{ background }}>
      {/* Background media, if any */}
      {scene.background?.type === "image" && scene.background.value && (
        <Img
          src={backgroundSrc}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
      {scene.background?.type === "video" && scene.background.value && (
        <Html5Video
          src={backgroundSrc}
          muted
          loop
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
      {scene.background?.type === "lottie" && scene.background.value && (
        <LottieElement
          el={{ id: `${scene.id}-background` }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
          lottieSrc={backgroundSrc}
          localFrame={frame}
        />
      )}

      {/* Design-space stage scaled to fill the output canvas. */}
      <div
        style={{
          position: "absolute",
          left: offsetX,
          top: offsetY,
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `scale(${scaleFit})`,
          transformOrigin: "top left",
        }}
      >
      {sortedEls.map((el: any) => {
        const isText =
          el.type === "text" ||
          typeof el.content?.text === "string" ||
          !!el.content?.role;
        // Timeline-driven timing takes precedence over word-bound reveal.
        const hasTimeline =
          typeof el.start_ms === "number" || typeof el.end_ms === "number";
        const revealMs = hasTimeline
          ? Math.max(0, el.start_ms ?? 0)
          : elementRevealMs(scene, el);
        const endMs = hasTimeline
          ? (el.end_ms ?? scene.duration_ms ?? Number.POSITIVE_INFINITY)
          : Number.POSITIVE_INFINITY;
        const revealFrame = Math.round((revealMs / 1000) * fps);
        const endFrame = Number.isFinite(endMs)
          ? Math.round((endMs / 1000) * fps)
          : Number.POSITIVE_INFINITY;
        const dur = isText ? TEXT_REVEAL_FRAMES : BLOCK_REVEAL_FRAMES;

        if (frame < revealFrame || frame >= endFrame) return null;

        // Text elements own their entrance animation (fade/slide/typewriter/
        // word-reveal/bounce/...) inside TextElement, so don't double-fade
        // them at the wrapper level — that flattened every variant into a
        // plain fade in the rendered video.
        const opacity = isText
          ? 1
          : interpolate(
              frame,
              [revealFrame, revealFrame + dur],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              },
            );

        // Per-element entrance for non-text blocks (mirrors AnimationBlock CSS keyframes)
        const ia = el.content?.icon_animation as
          | { type?: string; duration?: number; delay?: number }
          | undefined;
        const iaDurFrames = !isText && ia && ia.type && ia.type !== "none"
          ? Math.max(1, Math.round(((ia.duration ?? 600) / 1000) * fps))
          : dur;
        const iaDelayFrames = !isText && ia && ia.type && ia.type !== "none"
          ? Math.max(0, Math.round(((ia.delay ?? 0) / 1000) * fps))
          : 0;
        const iaStart = revealFrame + iaDelayFrames;
        const iaEnd = iaStart + iaDurFrames;
        const iaT = interpolate(frame, [iaStart, iaEnd], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });

        let translateX = 0;
        let translateY = 0;
        let scale = isText ? 1 : interpolate(frame, [revealFrame, revealFrame + dur], [0.92, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });
        let rotate = 0;
        let blurPx = 0;
        let iaOpacity = opacity;

        if (!isText && ia && ia.type && ia.type !== "none") {
          iaOpacity = iaT;
          switch (ia.type) {
            case "fade": scale = 1; break;
            case "scale": scale = 0.7 + 0.3 * iaT; break;
            case "pop":
              scale = iaT < 0.6 ? 0.4 + (1.15 - 0.4) * (iaT / 0.6) : 1.15 - 0.15 * ((iaT - 0.6) / 0.4);
              break;
            case "bounce":
              scale = 0.8 + 0.2 * iaT;
              translateY = iaT < 0.6 ? -40 + 48 * (iaT / 0.6) : 8 - 8 * ((iaT - 0.6) / 0.4);
              break;
            case "slide-up":    scale = 1; translateY = 28 * (1 - iaT); break;
            case "slide-down":  scale = 1; translateY = -28 * (1 - iaT); break;
            case "slide-left":  scale = 1; translateX = 36 * (1 - iaT); break;
            case "slide-right": scale = 1; translateX = -36 * (1 - iaT); break;
            case "spin":  scale = 0.6 + 0.4 * iaT; rotate = -180 * (1 - iaT); break;
            case "flip":  scale = 1; rotate = 0; break; // perspective 3D not modeled here
            case "blur":  scale = 1.05 - 0.05 * iaT; blurPx = 14 * (1 - iaT); break;
          }
        }

        // Apply scene-level element transitions (persisted in scene.transitions).
        const txMap = (scene.transitions ?? {}) as Record<string, TxEntry>;
        const enterTx = findTx(txMap, "to", el.id);
        const exitTx = findTx(txMap, "from", el.id);
        let txMul = 1, txTx = 0, txTy = 0, txScale = 1, txBlur = 0;
        if (enterTx) {
          const durF = Math.max(1, Math.round((enterTx.duration_ms / 1000) * fps));
          if (frame >= revealFrame && frame <= revealFrame + durF) {
            const t = (frame - revealFrame) / durF;
            const r = txTransform(enterTx.type, Math.max(0, Math.min(1, t)), "enter");
            txMul *= r.opacity; txTx += r.translateX; txTy += r.translateY; txScale *= r.scale; txBlur = Math.max(txBlur, r.blurPx);
          }
        }
        if (exitTx && Number.isFinite(endFrame)) {
          const durF = Math.max(1, Math.round((exitTx.duration_ms / 1000) * fps));
          const exitStart = (endFrame as number) - durF;
          if (frame >= exitStart && frame <= endFrame) {
            const t = (frame - exitStart) / durF;
            const r = txTransform(exitTx.type, Math.max(0, Math.min(1, t)), "exit");
            txMul *= r.opacity; txTx += r.translateX; txTy += r.translateY; txScale *= r.scale; txBlur = Math.max(txBlur, r.blurPx);
          }
        }

        const style: React.CSSProperties = {
          position: "absolute",
          left: el.position?.x ?? 0,
          top: el.position?.y ?? 0,
          width: el.position?.w ?? 100,
          height: el.position?.h ?? 100,
          zIndex: el.z_index ?? 0,
          opacity: iaOpacity * txMul,
          transform: `translate(${translateX + txTx}px, ${translateY + txTy}px) scale(${scale * txScale}) rotate(${rotate}deg)`,
          transformOrigin: "center center",
          filter: (blurPx + txBlur) > 0 ? `blur(${blurPx + txBlur}px)` : undefined,
          overflow: "hidden",
        };

        const sinceMs = ((frame - revealFrame) / fps) * 1000;
        const localFrame = frame - revealFrame;

        if (isText)
          return (
            <TextElement
              key={el.id}
              el={el}
              style={style}
              revealFrame={revealFrame}
              currentFrame={frame}
              fps={fps}
            />
          );

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

        const rawVideoSrc =
          c.video_url ||
          (c.preview_url && /\.(mp4|webm|mov)(\?|$)/i.test(c.preview_url)
            ? c.preview_url
            : null);
        // Skip if the "video" url is actually an image (svg/png/jpg) —
        // happens when icon assets get stored in video_url by mistake.
        const videoSrc =
          rawVideoSrc && !/\.(svg|png|jpe?g|gif|webp|avif)(\?|$)/i.test(rawVideoSrc)
            ? rawVideoSrc
            : null;
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
          c.svg_url ||
          (rawVideoSrc && /\.(svg|png|jpe?g|gif|webp|avif)(\?|$)/i.test(rawVideoSrc)
            ? rawVideoSrc
            : null);
        if (imageSrc) {
          return (
            <ImageElement key={el.id} el={el} style={style} src={imageSrc} />
          );
        }

        if (c.shape_type)
          return <ShapeElement key={el.id} el={el} style={style} />;

        return null;
      })}
      </div>
    </AbsoluteFill>
  );
};
