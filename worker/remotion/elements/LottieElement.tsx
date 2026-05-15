import { Lottie } from "@remotion/lottie";
import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { WhiteKeyFilterDef, whiteKeyFilterCss } from "./WhiteKeyFilter";

export const LottieElement: React.FC<{
  el: any;
  style: React.CSSProperties;
  lottieSrc: string;
  localFrame: number;
}> = ({ el, style, lottieSrc }) => {
  const [json, setJson] = useState<any | null>(null);
  const [handle] = useState(() => delayRender(`lottie:${lottieSrc}`));

  useEffect(() => {
    let cancelled = false;
    fetch(lottieSrc)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setJson(data);
        continueRender(handle);
      })
      .catch((err) => {
        console.error("lottie fetch failed", lottieSrc, err);
        continueRender(handle);
      });
    return () => {
      cancelled = true;
    };
  }, [lottieSrc, handle]);

  if (!json) return <div style={style} />;
  const removeBg = !!el?.content?.remove_background;
  return (
    <div style={style}>
      {removeBg && <WhiteKeyFilterDef />}
      <div style={{ width: "100%", height: "100%", filter: whiteKeyFilterCss(removeBg) }}>
        <Lottie
          animationData={json}
          loop
          playbackRate={1}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
};
