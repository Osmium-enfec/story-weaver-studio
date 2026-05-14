import { Img } from "remotion";

export const ImageElement: React.FC<{
  el: any;
  style: React.CSSProperties;
  src: string;
}> = ({ el, style, src }) => {
  const fit: any = el?.content?.object_fit ?? "contain";
  return (
    <div style={style}>
      <Img
        src={src}
        style={{ width: "100%", height: "100%", objectFit: fit }}
      />
    </div>
  );
};
