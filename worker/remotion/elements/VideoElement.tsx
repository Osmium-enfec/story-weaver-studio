import { OffthreadVideo } from "remotion";

const VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i;

/**
 * Use OffthreadVideo so Remotion extracts the exact frame via ffmpeg per
 * composition frame. If the src is actually an image (svg/png/jpg) — which
 * happens when an Iconify/Iconscout icon got mis-classified as a video — fall
 * back to <img> so the bundled compositor doesn't error with
 * "Decoder not found".
 */
export const VideoElement: React.FC<{
  el: any;
  style: React.CSSProperties;
  src: string;
  startMs: number;
}> = ({ style, src }) => {
  const isVideo = VIDEO_RE.test(src);
  return (
    <div style={style}>
      {isVideo ? (
        <OffthreadVideo
          src={src}
          muted
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      ) : (
        <img
          src={src}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      )}
    </div>
  );
};
