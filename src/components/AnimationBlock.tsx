import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Sparkles } from "lucide-react";
import type { AnimationProvider } from "@/lib/animation-providers";

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
      <div style={{ ...wrapperStyle, isolation: "isolate" }} className="pointer-events-none">
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
