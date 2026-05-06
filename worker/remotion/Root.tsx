import { Composition } from "remotion";
import { MainVideo } from "./MainVideo.js";

export const Root = () => (
  <Composition
    id="main"
    component={MainVideo as any}
    durationInFrames={150}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{ scenes: [] as any[], project: null as any }}
  />
);
