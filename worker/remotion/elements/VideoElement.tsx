import { Html5Video } from "remotion";
import { WhiteKeyFilterDef, whiteKeyFilterCss } from "./WhiteKeyFilter";

const VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i;

export const VideoElement: React.FC<{
  el: any;
  style: React.CSSProperties;
  src: string;
  startMs: number;
}> = ({ el, style, src }) => {
  const isVideo = VIDEO_RE.test(src);
  const removeBg = !!el?.content?.remove_background;
  const mediaStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    filter: whiteKeyFilterCss(removeBg),
  };
  return (
    <div style={style}>
      {removeBg && <WhiteKeyFilterDef />}
      {isVideo ? (
        <Html5Video src={src} muted loop style={mediaStyle} />
      ) : (
        <img src={src} style={mediaStyle} />
      )}
    </div>
  );
};
