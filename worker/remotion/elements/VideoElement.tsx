import { OffthreadVideo } from "remotion";

/**
 * Use OffthreadVideo so Remotion extracts the exact frame via ffmpeg per
 * composition frame, instead of relying on the headless browser's video tag.
 */
export const VideoElement: React.FC<{
  el: any;
  style: React.CSSProperties;
  src: string;
  startMs: number;
}> = ({ style, src }) => {
  return (
    <div style={style}>
      <OffthreadVideo
        src={src}
        muted
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </div>
  );
};
