import { Img } from "remotion";
import { WhiteKeyFilterDef, whiteKeyFilterCss } from "./WhiteKeyFilter";

export const ImageElement: React.FC<{
  el: any;
  style: React.CSSProperties;
  src: string;
}> = ({ el, style, src }) => {
  const fit: any = el?.content?.object_fit ?? "contain";
  const removeBg = !!el?.content?.remove_background;
  return (
    <div style={style}>
      {removeBg && <WhiteKeyFilterDef />}
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: fit,
          filter: whiteKeyFilterCss(removeBg),
        }}
      />
    </div>
  );
};
