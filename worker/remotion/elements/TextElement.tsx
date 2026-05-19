import { useLayoutEffect, useRef, useState } from "react";

type AnimType =
  | "none"
  | "fade"
  | "slide-up"
  | "slide-left"
  | "slide-right"
  | "scale"
  | "typewriter"
  | "word-reveal"
  | "bounce";

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
}

/**
 * Deterministic per-frame text entrance animation that mirrors the editor's
 * CSS @keyframes (text-fade-in / text-slide-up / text-scale-in / text-bounce
 * / typewriter / word-reveal). The wrapper in SceneRenderer no longer applies
 * its own opacity to text, so this is the single source of truth.
 */
function computeTextAnim(
  type: AnimType,
  localMs: number,
  duration: number,
  delay: number,
): {
  opacity: number;
  translateX: number;
  translateY: number;
  scaleMul: number;
} {
  const t = easeOutCubic((localMs - delay) / Math.max(1, duration));
  if (localMs < delay)
    return { opacity: 0, translateX: 0, translateY: 0, scaleMul: 1 };

  switch (type) {
    case "fade":
      return { opacity: t, translateX: 0, translateY: 10 * (1 - t), scaleMul: 1 };
    case "slide-up":
      return { opacity: t, translateX: 0, translateY: 24 * (1 - t), scaleMul: 1 };
    case "slide-left":
      return { opacity: t, translateX: 32 * (1 - t), translateY: 0, scaleMul: 1 };
    case "slide-right":
      return { opacity: t, translateX: -32 * (1 - t), translateY: 0, scaleMul: 1 };
    case "scale":
      return { opacity: t, translateX: 0, translateY: 0, scaleMul: 0.82 + 0.18 * t };
    case "bounce": {
      const s =
        t < 0.6
          ? 0.6 + (1.15 - 0.6) * (t / 0.6)
          : 1.15 - 0.15 * ((t - 0.6) / 0.4);
      const op = t < 0.6 ? t / 0.6 : 1;
      return { opacity: op, translateX: 0, translateY: 0, scaleMul: s };
    }
    default:
      return { opacity: 1, translateX: 0, translateY: 0, scaleMul: 1 };
  }
}

export const TextElement: React.FC<{
  el: any;
  style: React.CSSProperties;
  revealFrame?: number;
  currentFrame?: number;
  fps?: number;
}> = ({ el, style, revealFrame = 0, currentFrame = 0, fps = 30 }) => {
  const c = el.content ?? {};
  const align: React.CSSProperties["textAlign"] =
    (c.align as any) || (c.text_align as any) || "center";

  const justifyContent =
    align === "left"
      ? "flex-start"
      : align === "right"
      ? "flex-end"
      : "center";

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    inner.style.transform = "none";
    const naturalW = inner.scrollWidth || 1;
    const naturalH = inner.scrollHeight || 1;
    const boxW = wrap.clientWidth;
    const boxH = wrap.clientHeight;
    const s = Math.max(0.05, Math.min(boxW / naturalW, boxH / naturalH, 1));
    setScale(s);
    inner.style.transform = `scale(${s})`;
  }, [
    c.text,
    c.font_size,
    c.fontSize,
    c.font_family,
    c.fontFamily,
    c.font_weight,
    c.fontWeight,
    c.line_height,
    c.lineHeight,
    style.width,
    style.height,
  ]);

  const anim = c.text_animation as
    | { type?: AnimType; duration?: number; delay?: number }
    | undefined;
  const animType: AnimType = (anim?.type as AnimType) || "fade";
  const animDuration = anim?.duration ?? 600;
  const animDelay = anim?.delay ?? 0;

  const localMs = ((currentFrame - revealFrame) / fps) * 1000;

  const isStaggered = animType === "typewriter" || animType === "word-reveal";

  const text: string = c.text ?? "";

  let blockOpacity = 1;
  let translateX = 0;
  let translateY = 0;
  let scaleMul = 1;

  if (!isStaggered) {
    const r = computeTextAnim(animType, localMs, animDuration, animDelay);
    blockOpacity = r.opacity;
    translateX = r.translateX;
    translateY = r.translateY;
    scaleMul = r.scaleMul;
  }

  const renderStaggered = () => {
    const units =
      animType === "typewriter" ? Array.from(text) : text.split(/(\s+)/);
    const visible =
      units.filter((u) => animType === "typewriter" || u.trim().length > 0)
        .length || 1;
    const per = animDuration / visible;
    let i = 0;
    return units.map((u, idx) => {
      const isVisibleUnit =
        animType === "typewriter" || u.trim().length > 0;
      if (!isVisibleUnit) {
        return (
          <span key={idx} style={{ whiteSpace: "pre" }}>
            {u}
          </span>
        );
      }
      const unitDelay = animDelay + i * per;
      i++;
      const tt = easeOutCubic((localMs - unitDelay) / Math.max(1, per));
      const op = localMs < unitDelay ? 0 : tt;
      const ty = 8 * (1 - (localMs < unitDelay ? 0 : tt));
      return (
        <span
          key={idx}
          style={{
            display: "inline-block",
            opacity: op,
            transform: `translateY(${ty}px)`,
            whiteSpace: "pre",
          }}
        >
          {u}
        </span>
      );
    });
  };

  return (
    <div
      ref={wrapRef}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        justifyContent,
        padding: c.padding ?? 0,
        background: c.background ?? "transparent",
        overflow: "hidden",
        opacity: (style.opacity ?? 1) * blockOpacity,
      }}
    >
      <div
        ref={innerRef}
        style={{
          display: "inline-block",
          color: c.color ?? c.fill ?? "#0f172a",
          fontFamily:
            c.font_family ||
            c.fontFamily ||
            "Inter, system-ui, -apple-system, sans-serif",
          fontSize: c.font_size ?? c.fontSize ?? 32,
          fontWeight: c.font_weight ?? c.fontWeight ?? 400,
          fontStyle: c.font_style ?? c.fontStyle ?? "normal",
          lineHeight: c.line_height ?? c.lineHeight ?? 1.2,
          letterSpacing: c.letter_spacing ?? c.letterSpacing ?? "normal",
          textAlign: align,
          textTransform:
            c.text_transform === "uppercase" ? "uppercase" : "none",
          whiteSpace: "pre",
          wordBreak: "normal",
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale * scaleMul})`,
          transformOrigin: "center center",
          background: c.text_bg_color || undefined,
          padding: c.text_bg_color
            ? `${c.text_bg_padding_y ?? 12}px ${c.text_bg_padding_x ?? 24}px`
            : undefined,
          borderRadius: c.text_bg_color ? c.text_bg_radius ?? 4 : undefined,
          border:
            c.text_bg_border_color && (c.text_bg_border_width ?? 0) > 0
              ? `${c.text_bg_border_width}px solid ${c.text_bg_border_color}`
              : undefined,
        }}
      >
        {isStaggered ? renderStaggered() : text}
      </div>
    </div>
  );
};
