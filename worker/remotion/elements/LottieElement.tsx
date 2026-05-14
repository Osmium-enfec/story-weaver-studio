import { Lottie } from "@remotion/lottie";
import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";

/**
 * Frame-accurate Lottie. We fetch the JSON once (delaying render until ready)
 * so headless Chromium has the data before the encoder samples the frame.
 *
 * `@remotion/lottie` is `useCurrentFrame()`-aware internally, so just by
 * mounting it inside a Remotion composition the playhead is deterministic
 * per frame.
 */
export const LottieElement: React.FC<{
  el: any;
  style: React.CSSProperties;
  lottieSrc: string;
  localFrame: number;
}> = ({ style, lottieSrc }) => {
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
  return (
    <div style={style}>
      <Lottie
        animationData={json}
        loop
        playbackRate={1}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
};
