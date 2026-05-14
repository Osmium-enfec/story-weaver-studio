import { Composition } from "remotion";
import { MainVideo } from "./MainVideo";

export const Root: React.FC = () => (
  <Composition
    id="main"
    component={MainVideo as any}
    durationInFrames={300}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{
      scenes: [] as any[],
      includeAudio: true,
      width: 1920,
      height: 1080,
      fps: 30,
    }}
    calculateMetadata={({ props }) => {
      const totalMs =
        (props.scenes ?? []).reduce(
          (s: number, sc: any) => s + (sc.duration_ms ?? 4000),
          0,
        ) || 4000;
      const fps = (props as any).fps ?? 30;
      const width = (props as any).width ?? 1920;
      const height = (props as any).height ?? 1080;
      return {
        durationInFrames: Math.max(fps, Math.round((totalMs / 1000) * fps)),
        fps,
        width,
        height,
      };
    }}
  />
);
