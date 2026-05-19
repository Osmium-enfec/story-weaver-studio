import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProject } from "@/components/project-context";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipForward, SkipBack } from "lucide-react";
import { BackgroundLayer, type SceneBackground } from "@/components/BackgroundPicker";
import { AnimationBlockRenderer, TextBlockRenderer, type AnimationBlockContent } from "@/components/AnimationBlock";
import { DESIGN, cellRect } from "@/lib/grid";

export const Route = createFileRoute("/projects/$projectId/preview")({
  component: PreviewPage,
});

interface PreviewElement {
  id: string;
  scene_id: string;
  type?: string;
  content: AnimationBlockContent;
  position: { x: number; y: number; w: number; h: number };
  z_index: number;
}

interface PreviewScene {
  id: string;
  narration: string;
  duration_ms: number;
  background: SceneBackground;
  elements: PreviewElement[];
}

function PreviewPage() {
  const { projectId } = useParams({ from: "/projects/$projectId/preview" });
  const { project } = useProject();
  const [scenes, setScenes] = useState<PreviewScene[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playRun, setPlayRun] = useState(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("scenes")
        .select("id, narration, duration_ms, background, order_index")
        .eq("project_id", projectId)
        .order("order_index");

      const sceneRows = (data ?? []) as unknown as Array<Omit<PreviewScene, "elements">>;
      const ids = sceneRows.map((scene) => scene.id);
      if (ids.length === 0) {
        setScenes([]);
        return;
      }

      const { data: elements } = await supabase
        .from("scene_elements")
        .select("id, scene_id, type, content, position, z_index")
        .in("scene_id", ids)
        .order("z_index");

      const elementRows = (elements ?? []) as unknown as PreviewElement[];
      setScenes(
        sceneRows.map((scene) => ({
          ...scene,
          background: scene.background as SceneBackground,
          elements: elementRows.filter((el) => el.scene_id === scene.id),
        })),
      );
    })();
  }, [projectId]);

  useEffect(() => {
    if (!playing || scenes.length === 0) return;
    const dur = scenes[idx]?.duration_ms ?? 3500;
    const t = setTimeout(() => {
      if (idx + 1 >= scenes.length) setPlaying(false);
      else {
        setIdx(idx + 1);
        setPlayRun((run) => run + 1);
      }
    }, dur);
    return () => clearTimeout(t);
  }, [playing, idx, scenes]);

  useEffect(() => {
    if (idx >= scenes.length) setIdx(Math.max(0, scenes.length - 1));
  }, [idx, scenes.length]);

  const ratio = project.aspect_ratio;
  const aspect = ratio === "9:16" ? "9/16" : ratio === "1:1" ? "1/1" : "16/9";
  const current = scenes[idx];

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    setPlayRun((run) => run + 1);
    setPlaying(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center">
        <div
          className="overflow-hidden rounded-xl bg-card shadow-2xl"
          style={{ aspectRatio: aspect, width: ratio === "9:16" ? "360px" : "min(900px, 100%)" }}
        >
          <div className="relative h-full w-full overflow-hidden">
            {current ? <BackgroundLayer background={current.background} /> : null}
            {current ? [...current.elements].sort((a, b) => a.z_index - b.z_index).map((el, elementIdx) => {
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
                  {isText ? (
                    <TextBlockRenderer
                      key={`${el.id}-${playing ? "play" : "idle"}-${playRun}`}
                      content={el.content}
                      animating={playing}
                    />
                  ) : (
                    <AnimationBlockRenderer
                      key={`${el.id}-${playing ? "play" : "idle"}-${playRun}`}
                      content={el.content}
                    />
                  )}
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
        <Button size="lg" onClick={togglePlay} disabled={scenes.length === 0}>
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
    </div>
  );
}
