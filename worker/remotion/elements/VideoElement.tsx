import { Html5Video } from "remotion";

const VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i;

/**
 * Use Html5Video instead of OffthreadVideo for remote mirrored clips. The
 * OffthreadVideo path calls Remotion's ffmpeg frame extractor, which can fail
 * with "Decoder not found" even for otherwise browser-playable MP4 assets.
 * If the src is actually an image (svg/png/jpg), fall back to <img>.
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
        <Html5Video
          src={src}
          muted
          loop
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
