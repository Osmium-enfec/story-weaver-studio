import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
}

export function TextBlockRenderer({
  content,
  editable,
  onChange,
}: {
  content: AnimationBlockContent;
  editable?: boolean;
  onChange?: (text: string) => void;
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
          fontFamily: content.font_family || "Inter",
          fontSize: baseSize + "px",
          fontWeight: content.font_weight ?? 400,
          lineHeight: content.line_height ?? 1.4,
          color: content.color || "#0f172a",
          cursor: editable ? "text" : "default",
          whiteSpace: "pre",
          transformOrigin: "center center",
          transform: `scale(${scale})`,
          display: "inline-block",
        }}
      >
        {text}
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

  // Fallback: internal placeholder block
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
