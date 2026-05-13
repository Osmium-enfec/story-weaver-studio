import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Sparkles } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { AnimationProvider } from "@/lib/animation-providers";

// Measure text natural pixel size using a canvas at the given font.
export function measureTextSize(
  text: string,
  opts: { fontFamily?: string; fontSize?: number; fontWeight?: number; lineHeight?: number },
): { w: number; h: number } {
  const family = opts.fontFamily || "Inter";
  const size = opts.fontSize ?? 24;
  const weight = opts.fontWeight ?? 400;
  const lh = opts.lineHeight ?? 1.4;
  if (typeof document === "undefined") {
    return { w: Math.max(40, size * (text?.length || 1) * 0.55), h: Math.max(size * lh, size) };
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { w: Math.max(40, size * (text?.length || 1) * 0.55), h: size * lh };
  ctx.font = `${weight} ${size}px ${family}`;
  const lines = (text || " ").split("\n");
  let maxW = 0;
  for (const line of lines) maxW = Math.max(maxW, ctx.measureText(line || " ").width);
  const w = Math.ceil(maxW) + 8; // small padding
  const h = Math.ceil(lines.length * size * lh) + 4;
  return { w: Math.max(24, w), h: Math.max(24, h) };
}

export interface AnimationBlockContent {
  provider: AnimationProvider;
  name: string;
  slug?: string;
  lottie_url?: string | null;
  video_url?: string | null;
  /** Static image (svg/png/jpg) — for iconify, unsplash, ai-image, iconscout thumbnails. */
  image_url?: string | null;
  external_id?: string | null;
  // playback
  loop?: boolean;
  autoplay?: boolean;
  speed?: number;
  // style
  opacity?: number;
  rotation?: number;
  // color
  color_support?: "fixed" | "theme" | "custom";
  tint?: string | null;
  // word binding (for timed reveal during playback)
  word?: string | null;
  occurrence?: number | null;
  // background removal (keeps original; just toggles rendering)
  remove_background?: boolean;
  // text block
  text?: string;
  role?: "heading" | "subheading" | "paragraph";
  font_family?: string;
  font_size?: number;
  font_weight?: number;
  line_height?: number;
  color?: string;
  letter_spacing?: number;
  italic?: boolean;
  text_transform?: "none" | "uppercase";
  // text animation
  text_animation?: {
    type: "none" | "fade" | "slide-up" | "slide-left" | "slide-right" | "scale" | "typewriter" | "word-reveal" | "bounce";
    duration?: number; // ms
    delay?: number;    // ms
    easing?: string;
  };
  // simple vector shapes
  shape_type?: ShapeType;
  shape_stroke_width?: number;
  // text "banner / sticker" background (renders behind text inside the same block)
  text_bg_color?: string | null;
  text_bg_padding_x?: number;
  text_bg_padding_y?: number;
  text_bg_radius?: number;
  text_bg_border_color?: string | null;
  text_bg_border_width?: number;
}

export type ShapeType =
  | "line" | "dashed-line" | "dotted-line" | "arrow-right" | "arrow-left" | "arrow-up" | "arrow-down"
  | "square" | "rounded-square" | "circle" | "triangle" | "inverted-triangle"
  | "pentagon" | "hexagon" | "octagon" | "star-4" | "star-5" | "star-8";

function regularPolygonPoints(sides: number, radius = 42, rotation = -90) {
  return Array.from({ length: sides }, (_, i) => {
    const a = ((rotation + (360 / sides) * i) * Math.PI) / 180;
    return `${50 + Math.cos(a) * radius},${50 + Math.sin(a) * radius}`;
  }).join(" ");
}

function starPoints(points: number, outer = 44, inner = 24, rotation = -90) {
  return Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((rotation + (180 / points) * i) * Math.PI) / 180;
    return `${50 + Math.cos(a) * r},${50 + Math.sin(a) * r}`;
  }).join(" ");
}

export function ShapeGlyph({ type, color = "#111827", strokeWidth = 7 }: { type: ShapeType; color?: string; strokeWidth?: number }) {
  const strokeProps = { stroke: color, strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const fillProps = { fill: color };
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      {type === "line" && <line x1="8" y1="50" x2="92" y2="50" {...strokeProps} />}
      {type === "dashed-line" && <line x1="8" y1="50" x2="92" y2="50" strokeDasharray="14 10" {...strokeProps} />}
      {type === "dotted-line" && <line x1="8" y1="50" x2="92" y2="50" strokeDasharray="2 9" {...strokeProps} />}
      {type === "arrow-right" && <><line x1="8" y1="50" x2="82" y2="50" {...strokeProps} /><polyline points="68,30 92,50 68,70" fill="none" {...strokeProps} /></>}
      {type === "arrow-left" && <><line x1="92" y1="50" x2="18" y2="50" {...strokeProps} /><polyline points="32,30 8,50 32,70" fill="none" {...strokeProps} /></>}
      {type === "arrow-up" && <><line x1="50" y1="92" x2="50" y2="18" {...strokeProps} /><polyline points="30,32 50,8 70,32" fill="none" {...strokeProps} /></>}
      {type === "arrow-down" && <><line x1="50" y1="8" x2="50" y2="82" {...strokeProps} /><polyline points="30,68 50,92 70,68" fill="none" {...strokeProps} /></>}
      {type === "square" && <rect x="8" y="8" width="84" height="84" {...fillProps} />}
      {type === "rounded-square" && <rect x="8" y="8" width="84" height="84" rx="12" ry="12" {...fillProps} />}
      {type === "circle" && <ellipse cx="50" cy="50" rx="42" ry="42" {...fillProps} />}
      {type === "triangle" && <polygon points="50,8 92,92 8,92" {...fillProps} />}
      {type === "inverted-triangle" && <polygon points="8,8 92,8 50,92" {...fillProps} />}
      {type === "pentagon" && <polygon points={regularPolygonPoints(5)} {...fillProps} />}
      {type === "hexagon" && <polygon points={regularPolygonPoints(6, 43, -90)} {...fillProps} />}
      {type === "octagon" && <polygon points={regularPolygonPoints(8)} {...fillProps} />}
      {type === "star-4" && <polygon points="50,6 62,38 94,50 62,62 50,94 38,62 6,50 38,38" {...fillProps} />}
      {type === "star-5" && <polygon points={starPoints(5)} {...fillProps} />}
      {type === "star-8" && <polygon points={starPoints(8, 44, 30)} {...fillProps} />}
    </svg>
  );
}

const TEXT_ANIM_KEYFRAME: Record<string, string> = {
  fade: "text-fade-in",
  "slide-up": "text-slide-up",
  "slide-left": "text-slide-left",
  "slide-right": "text-slide-right",
  scale: "text-scale-in",
  bounce: "text-bounce",
};

export function TextBlockRenderer({
  content,
  editable,
  onChange,
  animating,
}: {
  content: AnimationBlockContent;
  editable?: boolean;
  onChange?: (text: string) => void;
  animating?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const baseSize = content.font_size ?? 24;
  const text = content.text ?? "";

  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      const inner = innerRef.current;
      if (!wrap || !inner) return;
      // Reset to measure natural size
      inner.style.transform = "none";
      const naturalW = inner.scrollWidth || 1;
      const naturalH = inner.scrollHeight || 1;
      const boxW = wrap.clientWidth;
      const boxH = wrap.clientHeight;
      const s = Math.max(0.05, Math.min(boxW / naturalW, boxH / naturalH));
      setScale(s);
      inner.style.transform = `scale(${s})`;
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [text, baseSize, content.font_family, content.font_weight, content.line_height]);

  const anim = content.text_animation;
  const animKey = animating && anim && anim.type !== "none" ? anim.type : null;
  const animName = animKey ? TEXT_ANIM_KEYFRAME[animKey] || "" : "";
  const animDuration = anim?.duration ?? 600;
  const animDelay = anim?.delay ?? 0;
  const animEasing = anim?.easing ?? "ease-out";
  const isStaggered = animKey === "typewriter" || animKey === "word-reveal";

  // Build staggered children for typewriter/word-reveal.
  const renderStaggered = () => {
    if (!animKey) return text;
    const units = animKey === "typewriter" ? Array.from(text) : text.split(/(\s+)/);
    const visible = units.filter((u) => animKey === "typewriter" || u.trim().length > 0).length || 1;
    const per = animDuration / visible;
    let i = 0;
    return units.map((u, idx) => {
      const isVisibleUnit = animKey === "typewriter" || u.trim().length > 0;
      const styleAnim: React.CSSProperties = isVisibleUnit
        ? {
            display: "inline-block",
            opacity: 0,
            animation: `text-unit-in ${per}ms ${animEasing} ${animDelay + i * per}ms forwards`,
            whiteSpace: "pre",
          }
        : { whiteSpace: "pre" };
      if (isVisibleUnit) i++;
      return (
        <span key={idx} style={styleAnim}>
          {u}
        </span>
      );
    });
  };

  return (
    <div
      ref={wrapRef}
      className="flex h-full w-full items-center justify-center overflow-hidden outline-none"
      style={{
        opacity: content.opacity ?? 1,
        transform: `rotate(${content.rotation ?? 0}deg)`,
      }}
    >
      <div
        ref={innerRef}
        contentEditable={editable}
        suppressContentEditableWarning
        onBlur={(e) => onChange?.(e.currentTarget.innerText)}
        onMouseDown={(e) => { if (editable) e.stopPropagation(); }}
        className="outline-none"
        style={{
          ["--text-render-scale" as string]: scale,
          fontFamily: content.font_family || "Inter",
          fontSize: baseSize + "px",
          fontWeight: content.font_weight ?? 400,
          fontStyle: content.italic ? "italic" : "normal",
          lineHeight: content.line_height ?? 1.4,
          color: content.color || "#0f172a",
          letterSpacing: content.letter_spacing ? `${content.letter_spacing}px` : undefined,
          textTransform: content.text_transform === "uppercase" ? "uppercase" : "none",
          cursor: editable ? "text" : "default",
          whiteSpace: "pre",
          transformOrigin: "center center",
          transform: `scale(${scale})`,
          display: "inline-block",
          background: content.text_bg_color || undefined,
          padding: content.text_bg_color
            ? `${content.text_bg_padding_y ?? 12}px ${content.text_bg_padding_x ?? 24}px`
            : undefined,
          borderRadius: content.text_bg_color ? (content.text_bg_radius ?? 4) : undefined,
          border: content.text_bg_border_color && (content.text_bg_border_width ?? 0) > 0
            ? `${content.text_bg_border_width}px solid ${content.text_bg_border_color}`
            : undefined,
          animation: !isStaggered && animName ? `${animName} ${animDuration}ms ${animEasing} ${animDelay}ms both` : undefined,
        }}
      >
        {isStaggered ? renderStaggered() : text}
      </div>
    </div>
  );
}

// SVG filter: keys out near-white pixels to transparent.
// Works on any canvas color (not dependent on blend mode).
const WHITE_KEY_FILTER_ID = "anim-white-key";
function WhiteKeyFilterDef() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <filter id={WHITE_KEY_FILTER_ID} colorInterpolationFilters="sRGB">
          {/* whiteAlpha = max(1-R, 1-G, 1-B) → white becomes 0, everything else 1 */}
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1 0 0 0 1" result="wR" />
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 -1 0 0 1" result="wG" />
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 -1 0 1" result="wB" />
          <feBlend in="wR" in2="wG" mode="lighten" result="wRG" />
          <feBlend in="wRG" in2="wB" mode="lighten" result="whiteAlpha" />

          {/* darkAlpha = max(R, G, B) → black becomes 0, everything else 1 */}
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="dR" />
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 1 0 0 0" result="dG" />
          <feColorMatrix in="SourceGraphic" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="dB" />
          <feBlend in="dR" in2="dG" mode="lighten" result="dRG" />
          <feBlend in="dRG" in2="dB" mode="lighten" result="darkAlpha" />

          {/* combined = whiteAlpha * darkAlpha → both white AND near-black become transparent */}
          <feComposite in="whiteAlpha" in2="darkAlpha" operator="arithmetic"
            k1="1" k2="0" k3="0" k4="0" result="rawAlpha" />

          {/* Stronger sharpen + higher cutoff: kills the dark anti-aliased halo / border ring */}
          <feComponentTransfer in="rawAlpha" result="keyAlpha">
            <feFuncA type="linear" slope="10" intercept="-1.2" />
          </feComponentTransfer>
          <feComposite in="SourceGraphic" in2="keyAlpha" operator="in" />
        </filter>
      </defs>
    </svg>
  );
}

export function AnimationBlockRenderer({
  content,
  exportMode = false,
}: {
  content: AnimationBlockContent;
  exportMode?: boolean;
}) {
  const isLottie =
    (content.provider === "lottie" || content.provider === "upload") && !!content.lottie_url;

  const tintFilter =
    content.tint && content.color_support !== "fixed"
      ? `drop-shadow(0 0 0 ${content.tint})`
      : "";
  const keyFilter = content.remove_background ? `url(#${WHITE_KEY_FILTER_ID})` : "";
  const combinedFilter = [tintFilter, keyFilter].filter(Boolean).join(" ") || undefined;

  const wrapperStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    padding: 0,
    opacity: content.opacity ?? 1,
    transform: `rotate(${content.rotation ?? 0}deg)`,
    filter: combinedFilter,
  };

  if (content.shape_type) {
    return (
      <div style={wrapperStyle} className="pointer-events-none flex h-full w-full items-center justify-center">
        <ShapeGlyph
          type={content.shape_type}
          color={content.color || content.tint || "#111827"}
          strokeWidth={content.shape_stroke_width ?? 7}
        />
      </div>
    );
  }

  if (exportMode && (isLottie || (content.provider === "iconscout" && content.video_url))) {
    return (
      <div
        style={wrapperStyle}
        className="flex h-full w-full items-center justify-center rounded-md bg-primary/10 text-center"
      >
        <div>
          <Sparkles className="mx-auto h-5 w-5 text-primary" />
          <p className="mt-1 text-xs font-medium text-primary">{content.name}</p>
        </div>
      </div>
    );
  }

  if (content.provider === "image" && (content.video_url || content.lottie_url)) {
    const src = content.video_url || content.lottie_url!;
    return (
      <div style={wrapperStyle} className="pointer-events-none">
        {content.remove_background && <WhiteKeyFilterDef />}
        <img
          src={src}
          alt={content.name}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>
    );
  }

  if (isLottie) {
    return (
      <div style={wrapperStyle} className="pointer-events-none">
        {content.remove_background && <WhiteKeyFilterDef />}
        <DotLottieReact
          src={content.lottie_url!}
          loop={content.loop ?? true}
          autoplay={content.autoplay ?? true}
          speed={content.speed ?? 1}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    );
  }

  if (content.provider === "iconscout" && content.video_url) {
    return (
      <div
        style={{ ...wrapperStyle, isolation: "isolate", overflow: "hidden" }}
        className="pointer-events-none"
      >
        {content.remove_background && <WhiteKeyFilterDef />}
        <video
          src={content.video_url}
          crossOrigin="anonymous"
          autoPlay={content.autoplay ?? true}
          loop={content.loop ?? true}
          muted
          playsInline
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            opacity: 0,
            animation: "anim-block-fade-in 180ms ease-out 80ms forwards",
          }}
        />
        <style>{`@keyframes anim-block-fade-in { to { opacity: 1; } }`}</style>
      </div>
    );
  }

  // Static image: iconify SVG, unsplash photo, ai-image, iconscout thumbnail
  const imageSrc =
    content.image_url ||
    ((content.provider === "iconify" || content.provider === "unsplash" || content.provider === "image" || content.provider === "iconscout")
      ? (content.video_url || content.lottie_url || null)
      : null);
  if (imageSrc) {
    // Iconify SVGs ship with width="1em" and fill="currentColor". Rendering them
    // through an <img> tag often collapses to 0×0 (em has no font context) and
    // currentColor stays invisible. Use CSS mask-image so the SVG acts as a
    // monochrome alpha mask that takes the theme color we paint underneath.
    if (content.provider === "iconify") {
      const tint = content.tint || content.color || "#0f172a";
      return (
        <div style={wrapperStyle} className="pointer-events-none">
          <div
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: tint,
              WebkitMaskImage: `url("${imageSrc}")`,
              maskImage: `url("${imageSrc}")`,
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              maskPosition: "center",
              WebkitMaskSize: "contain",
              maskSize: "contain",
              opacity: 0,
              animation: "anim-block-fade-in 220ms ease-out 60ms forwards",
            }}
          />
          <style>{`@keyframes anim-block-fade-in { to { opacity: 1; } }`}</style>
        </div>
      );
    }
    return (
      <div style={wrapperStyle} className="pointer-events-none">
        {content.remove_background && <WhiteKeyFilterDef />}
        <img
          src={imageSrc}
          alt={content.name}
          onError={(e) => console.warn("AnimationBlock img failed", imageSrc, e)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            opacity: 0,
            animation: "anim-block-fade-in 220ms ease-out 60ms forwards",
          }}
        />
        <style>{`@keyframes anim-block-fade-in { to { opacity: 1; } }`}</style>
      </div>
    );
  }

  // Fallback: internal placeholder block — show the anchored word, not the asset_query
  const fallbackLabel = (content.word || content.text || "").trim();
  return (
    <div
      style={wrapperStyle}
      className="flex h-full w-full items-center justify-center rounded-md bg-primary/5 text-center"
    >
      <div className="px-2">
        <Sparkles className="mx-auto h-5 w-5 text-primary/70" />
        {fallbackLabel ? (
          <p className="mt-1 text-sm font-semibold text-primary truncate">{fallbackLabel}</p>
        ) : null}
      </div>
    </div>
  );
}
