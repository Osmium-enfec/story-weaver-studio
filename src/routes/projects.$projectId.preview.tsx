import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Scene } from "@/lib/db-types";
import { useProject } from "@/components/project-context";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipForward, SkipBack } from "lucide-react";

export const Route = createFileRoute("/projects/$projectId/preview")({
  component: PreviewPage,
});

function PreviewPage() {
  const { projectId } = useParams({ from: "/projects/$projectId/preview" });
  const { project } = useProject();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("scenes")
        .select("*")
        .eq("project_id", projectId)
        .order("order_index");
      setScenes((data ?? []) as unknown as Scene[]);
    })();
  }, [projectId]);

  useEffect(() => {
    if (!playing || scenes.length === 0) return;
    const dur = scenes[idx]?.duration_ms ?? 3000;
    const t = setTimeout(() => {
      if (idx + 1 >= scenes.length) setPlaying(false);
      else setIdx(idx + 1);
    }, dur);
    return () => clearTimeout(t);
  }, [playing, idx, scenes]);

  const ratio = project.aspect_ratio;
  const aspect = ratio === "9:16" ? "9/16" : ratio === "1:1" ? "1/1" : "16/9";
  const current = scenes[idx];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center">
        <div
          className="overflow-hidden rounded-xl bg-card shadow-2xl"
          style={{
            aspectRatio: aspect,
            width: ratio === "9:16" ? "360px" : "min(900px, 100%)",
            background: current?.background?.value ?? "#fff",
          }}
        >
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            {current?.suggested_animation && (
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                {current.suggested_animation}
              </span>
            )}
            <p className="text-xl font-medium">{current?.narration ?? "No screens to preview"}</p>
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
    </div>
  );
}
