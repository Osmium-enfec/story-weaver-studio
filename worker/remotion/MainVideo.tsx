import {
  AbsoluteFill,
  Series,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Img,
} from "remotion";

interface Scene {
  id: string;
  title?: string | null;
  narration?: string;
  duration_ms?: number;
  background?: { type: string; value: string };
  scene_elements?: SceneElement[];
}

interface SceneElement {
  id: string;
  type: string;
  position: { x: number; y: number; w: number; h: number };
  z_index: number;
  start_ms: number;
  end_ms: number;
  content: any;
}

export const MainVideo: React.FC<{ scenes: Scene[]; project: any }> = ({
  scenes,
}) => {
  const { fps } = useVideoConfig();
  if (!scenes || scenes.length === 0) {
    return (
      <AbsoluteFill style={{ background: "#0f172a", color: "white" }}>
        <div style={{ margin: "auto", fontSize: 48 }}>No scenes</div>
      </AbsoluteFill>
    );
  }
  return (
    <Series>
      {scenes.map((s) => {
        const frames = Math.max(
          30,
          Math.round(((s.duration_ms ?? 5000) / 1000) * fps),
        );
        return (
          <Series.Sequence key={s.id} durationInFrames={frames}>
            <SceneRenderer scene={s} />
          </Series.Sequence>
        );
      })}
    </Series>
  );
};

const SceneRenderer: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const bg =
    scene.background?.type === "color"
      ? scene.background.value
      : "#ffffff";
  return (
    <AbsoluteFill style={{ background: bg, opacity }}>
      {scene.title && (
        <div
          style={{
            position: "absolute",
            top: 60,
            left: 80,
            fontSize: 56,
            fontWeight: 700,
            color: "#0f172a",
            fontFamily: "sans-serif",
          }}
        >
          {scene.title}
        </div>
      )}
      {(scene.scene_elements ?? []).map((el) => (
        <ElementRenderer key={el.id} el={el} />
      ))}
    </AbsoluteFill>
  );
};

const ElementRenderer: React.FC<{ el: SceneElement }> = ({ el }) => {
  const style: React.CSSProperties = {
    position: "absolute",
    left: el.position.x,
    top: el.position.y,
    width: el.position.w,
    height: el.position.h,
    zIndex: el.z_index,
  };
  if (el.type === "text") {
    return (
      <div
        style={{
          ...style,
          color: el.content?.color ?? "#0f172a",
          fontSize: el.content?.fontSize ?? 32,
          fontFamily: "sans-serif",
        }}
      >
        {el.content?.text ?? ""}
      </div>
    );
  }
  if (el.type === "image" || el.type === "icon") {
    const src = el.content?.url ?? el.content?.preview_url;
    if (!src) return null;
    return <Img src={src} style={{ ...style, objectFit: "contain" }} />;
  }
  if (el.type === "animation") {
    const src =
      el.content?.preview_url ??
      el.content?.thumbnail_url ??
      el.content?.url;
    if (!src) return null;
    return <Img src={src} style={{ ...style, objectFit: "contain" }} />;
  }
  return null;
};
