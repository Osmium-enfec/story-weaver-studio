import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  enqueueRenderJob,
  listRenderJobs,
} from "@/server/render-jobs.functions";
import { supabase } from "@/integrations/supabase/client";
import type { Scene } from "@/lib/db-types";
import { renderInBrowser } from "@/lib/browser-render";

export const Route = createFileRoute("/projects/$projectId/export")({
  component: ExportPage,
});

interface RenderJob {
  id: string;
  status: string;
  progress: number;
  output_url: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  settings: Record<string, unknown>;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "done") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

function ExportPage() {
  const { projectId } = useParams({ from: "/projects/$projectId/export" });
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [enqueuing, setEnqueuing] = useState(false);
  const [resolution, setResolution] = useState<"720p" | "1080p" | "4k">("1080p");
  const [browserRendering, setBrowserRendering] = useState(false);
  const [browserProgress, setBrowserProgress] = useState(0);

  async function startBrowserRender() {
    setBrowserRendering(true);
    setBrowserProgress(0);
    try {
      const { data, error } = await supabase
        .from("scenes")
        .select("*")
        .eq("project_id", projectId)
        .order("order_index");
      if (error) throw error;
      const scenes = (data ?? []) as Scene[];
      if (!scenes.length) throw new Error("No scenes to render");

      const blob = await renderInBrowser({
        scenes,
        width: 1920,
        height: 1080,
        fps: 30,
        onProgress: setBrowserProgress,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `render-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Render downloaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBrowserRendering(false);
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      const res = await listRenderJobs({ data: { projectId } });
      setJobs(res.jobs as RenderJob[]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function startRender() {
    setEnqueuing(true);
    try {
      await enqueueRenderJob({
        data: {
          projectId,
          settings: { resolution, audio: true, format: "mp4" },
        },
      });
      toast.success("Render queued");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnqueuing(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Download className="h-6 w-6" /> Export
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Renders run on the backend worker with full audio. Keep editing while
          they bake — the file appears here when done.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">Resolution</label>
          <div className="flex gap-1">
            {(["720p", "1080p", "4k"] as const).map((r) => (
              <Button
                key={r}
                size="sm"
                variant={resolution === r ? "default" : "outline"}
                onClick={() => setResolution(r)}
              >
                {r}
              </Button>
            ))}
          </div>
        </div>
        <Button onClick={startRender} disabled={enqueuing}>
          {enqueuing ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Render MP4
        </Button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium">Renders</h2>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No renders yet.</p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((j) => (
              <li
                key={j.id}
                className="rounded-md border bg-card p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(j.status)}>{j.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(j.created_at).toLocaleString()}
                    </span>
                  </div>
                  {(j.status === "rendering" || j.status === "pending") && (
                    <div className="mt-2 h-1.5 w-full rounded bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${j.progress}%` }}
                      />
                    </div>
                  )}
                  {j.error && (
                    <p className="text-xs text-destructive mt-1 truncate">
                      {j.error}
                    </p>
                  )}
                </div>
                {j.status === "done" && j.output_url && (
                  <Button asChild size="sm">
                    <a href={j.output_url} download>
                      <Download className="h-4 w-4 mr-1" /> MP4
                    </a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
