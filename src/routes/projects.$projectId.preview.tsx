import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Scene } from "@/lib/db-types";
import { useProject } from "@/components/project-context";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipForward, SkipBack } from "lucide-react";
import { PlaybackDialog, type PlaybackScene } from "@/components/PlaybackDialog";
import { BackgroundLayer, type SceneBackground } from "@/components/BackgroundPicker";
import { AnimationBlockRenderer, TextBlockRenderer } from "@/components/AnimationBlock";
import { DESIGN, cellRect } from "@/lib/grid";

export const Route = createFileRoute("/projects/$projectId/preview")({
  component: PreviewPage,
});

function PreviewPage() {
  const { projectId } = useParams({ from: "/projects/$projectId/preview" });
  const { project } = useProject();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [playbackScenes, setPlaybackScenes] = useState<PlaybackScene[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("scenes")
        .select("*")
        .eq("project_id", projectId)
        .order("order_index");
      const sceneRows = (data ?? []) as unknown as Array<Omit<PlaybackScene, "elements"> & Scene>;
      setScenes(sceneRows as unknown as Scene[]);
      const ids = sceneRows.map((scene) => scene.id);
      if (ids.length === 0) {
        setPlaybackScenes([]);
        return;
      }
      const { data: elements } = await supabase
        .from("scene_elements")
        .select("*")
        .in("scene_id", ids)
        .order("z_index");
      const elementRows = (elements ?? []) as unknown as Array<PlaybackScene["elements"][number] & { scene_id: string }>;
      setPlaybackScenes(
        ((data ?? []) as unknown as Scene[]).map((scene) => ({
          id: scene.id,
          background: scene.background as SceneBackground,
          narration: scene.narration,
          voice_url: scene.voice_url,
          voice_start_ms: scene.voice_start_ms,
          voice_end_ms: scene.voice_end_ms,
          word_timings: scene.word_timings,
          voice_trim_start_ms: scene.voice_trim_start_ms,
          voice_trim_end_ms: scene.voice_trim_end_ms,
          voice_cuts: scene.voice_cuts,
          voice_volume: scene.voice_volume,
          voice_fade_in_ms: scene.voice_fade_in_ms,
          voice_fade_out_ms: scene.voice_fade_out_ms,
          elements: elementRows.filter((el) => el.scene_id === scene.id),
        })),
      );
    })();
  }, [projectId]);

  const ratio = project.aspect_ratio;
  const aspect = ratio === "9:16" ? "9/16" : ratio === "1:1" ? "1/1" : "16/9";
  const current = scenes[idx];
  const currentPlayback = playbackScenes[idx];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center">
        <div
          className="overflow-hidden rounded-xl bg-card shadow-2xl"
          style={{ aspectRatio: aspect, width: ratio === "9:16" ? "360px" : "min(900px, 100%)" }}
        >
          <div className="relative h-full w-full overflow-hidden">
            {currentPlayback ? <BackgroundLayer background={currentPlayback.background} /> : null}
            {currentPlayback ? [...currentPlayback.elements].sort((a, b) => a.z_index - b.z_index).map((el, elementIdx) => {
              const isText = el.type === "text" || typeof el.content.text === "string" || !!el.content.role;
              const p = el.position;
              const rect = p && typeof p.w === "number" && p.w > 0 ? p : cellRect(elementIdx);
              return (
                <div
                  key={el.id}
                  className="absolute overflow-hidden"
                  style={{
                    left: `${(rect.x / DESIGN.w) * 100}%`,
                    top: `${(rect.y / DESIGN.h) * 100}%`,
                    width: `${(rect.w / DESIGN.w) * 100}%`,
                    height: `${(rect.h / DESIGN.h) * 100}%`,
                    zIndex: el.z_index,
                  }}
                >
                  {isText ? <TextBlockRenderer content={el.content} /> : <AnimationBlockRenderer content={el.content} />}
                </div>
              );
            }) : (
              <div className="flex h-full items-center justify-center p-8 text-center">
                <p className="text-xl font-medium">No screens to preview</p>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center gap-3">
        <Button variant="outline" size="icon" onClick={() => setIdx(Math.max(0, idx - 1))}>
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button size="lg" onClick={() => setPlaying((p) => !p)} disabled={scenes.length === 0}>
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          <span className="ml-2">{playing ? "Pause" : "Play"}</span>
        </Button>
        <Button variant="outline" size="icon" onClick={() => setIdx(Math.min(scenes.length - 1, idx + 1))}>
          <SkipForward className="h-4 w-4" />
        </Button>
        <span className="ml-3 text-sm text-muted-foreground">
          Screen {Math.min(idx + 1, scenes.length)} / {scenes.length}
        </span>
      </div>
      <PlaybackDialog
        open={playing}
        onOpenChange={setPlaying}
        scenes={playbackScenes}
        canvasSize={{ w: DESIGN.w, h: DESIGN.h }}
      />
    </div>
  );
}
