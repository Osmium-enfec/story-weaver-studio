import { AbsoluteFill, Series, Audio, useVideoConfig } from "remotion";
import { SceneRenderer } from "./SceneRenderer";

interface Scene {
  id: string;
  duration_ms?: number;
  voice_url?: string | null;
  voice_trim_start_ms?: number;
  voice_trim_end_ms?: number | null;
  voice_volume?: number;
  background?: { type: string; value: string };
  scene_elements?: any[];
  word_timings?: { text: string; start_ms: number; end_ms: number }[];
  voice_cuts?: { start_ms: number; end_ms: number }[];
}

export const MainVideo: React.FC<{
  scenes: Scene[];
  includeAudio?: boolean;
}> = ({ scenes, includeAudio = true }) => {
  const { fps } = useVideoConfig();

  if (!scenes || scenes.length === 0) {
    return (
      <AbsoluteFill
        style={{
          background: "#0f172a",
          color: "white",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 48,
        }}
      >
        No scenes
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ background: "#ffffff" }}>
      <Series>
        {scenes.map((scene) => {
          const frames = Math.max(
            1,
            Math.round(((scene.duration_ms ?? 4000) / 1000) * fps),
          );
          const trimStart = scene.voice_trim_start_ms ?? 0;
          const trimEnd = scene.voice_trim_end_ms ?? undefined;
          return (
            <Series.Sequence key={scene.id} durationInFrames={frames}>
              <SceneRenderer scene={scene} />
              {includeAudio && scene.voice_url && (
                <Audio
                  src={scene.voice_url}
                  startFrom={Math.round((trimStart / 1000) * fps)}
                  endAt={
                    trimEnd
                      ? Math.round((trimEnd / 1000) * fps)
                      : undefined
                  }
                  volume={scene.voice_volume ?? 1}
                />
              )}
            </Series.Sequence>
          );
        })}
      </Series>
    </AbsoluteFill>
  );
};
