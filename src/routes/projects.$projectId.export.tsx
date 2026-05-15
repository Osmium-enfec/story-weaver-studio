import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Film, ArrowLeft, Server, Cloud, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useProject } from "@/components/project-context";
import { QUALITY_PRESETS, type ExportQuality } from "@/lib/scene-exporter";
import { enqueueRenderJob, getRenderJob } from "@/server/render-jobs.functions";

export const Route = createFileRoute("/projects/$projectId/export")({
  component: ExportPage,
});

// Resolutions the server worker supports natively.
const WORKER_RESOLUTIONS = new Set<ExportQuality>([
  "720p",
  "1080p",
  "1080p60",
  "4k",
  "4k60",
]);

type QualityTier = "standard" | "high" | "max";

function qualityTierFor(q: ExportQuality): QualityTier {
  if (q === "4k" || q === "4k60") return "max";
  if (q === "1080p60" || q === "1440p") return "high";
  return "high";
}

interface JobState {
  id: string;
  status: "pending" | "rendering" | "done" | "failed" | "error" | "cancelled";
  progress: number;
  output_url: string | null;
  error: string | null;
}

function ExportPage() {
  const { projectId } = useParams({ from: "/projects/$projectId/export" });
  const { project } = useProject();
  const enqueue = useServerFn(enqueueRenderJob);
  const fetchJob = useServerFn(getRenderJob);

  const [quality, setQuality] = useState<ExportQuality>("4k60");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [running, setRunning] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, []);

  async function startRender() {
    if (!WORKER_RESOLUTIONS.has(quality)) {
      toast.error(
        `${quality} isn't supported by the server renderer yet. Pick 720p, 1080p, 1080p60, 4K, or 4K60.`,
      );
      return;
    }
    setRunning(true);
    setJob(null);
    try {
      const res = await enqueue({
        data: {
          projectId,
          settings: {
            resolution: quality,
            quality: qualityTierFor(quality),
            includeAudio,
          },
        },
      });
      const j = res.job;
      setJob({
        id: j.id,
        status: j.status,
        progress: j.progress ?? 0,
        output_url: j.output_url ?? null,
        error: j.error ?? null,
      });
      toast.success("Render queued on server");
      poll(j.id);
    } catch (e) {
      console.error(e);
      toast.error((e as Error).message);
      setRunning(false);
    }
  }

  function poll(jobId: string) {
    const tick = async () => {
      try {
        const { job: j } = await fetchJob({ data: { jobId } });
        setJob({
          id: j.id,
          status: j.status as JobState["status"],
          progress: j.progress ?? 0,
          output_url: j.output_url ?? null,
          error: j.error ?? null,
        });
        if (j.status === "done") {
          setRunning(false);
          toast.success("Render complete");
          return;
        }
        if (j.status === "failed" || j.status === "error" || j.status === "cancelled") {
          setRunning(false);
          toast.error(j.error || "Render failed");
          return;
        }
        pollRef.current = window.setTimeout(tick, 2000);
      } catch (e) {
        console.error(e);
        pollRef.current = window.setTimeout(tick, 4000);
      }
    };
    tick();
  }

  const baseName = (project.title || "code-motion").replace(/[^\w-]+/g, "-");

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2 h-8">
          <Link to="/projects/$projectId/script" params={{ projectId }}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to project
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Download className="h-6 w-6" /> Export
        </h1>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
          <Server className="h-4 w-4" />
          Frame-accurate server-side render. You can close this tab — the job keeps running.
        </p>
      </div>

      <section className="rounded-lg border bg-card p-4 space-y-4">
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Quality</Label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.keys(QUALITY_PRESETS) as ExportQuality[]).map((q) => {
              const p = QUALITY_PRESETS[q];
              const mbps = Math.round(p.bitsPerSecond / 1_000_000);
              const supported = WORKER_RESOLUTIONS.has(q);
              return (
                <Button
                  key={q}
                  variant={quality === q ? "default" : "outline"}
                  size="sm"
                  onClick={() => setQuality(q)}
                  disabled={running || !supported}
                  className="h-auto flex-col items-start py-2"
                  title={supported ? "" : "Not supported by server renderer"}
                >
                  <span className="font-medium">
                    {p.label}
                    {!supported && " (n/a)"}
                  </span>
                  <span className="text-[10px] opacity-70">
                    {p.width}×{p.height} · {p.fps}fps · {mbps} Mbps
                  </span>
                </Button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            4K60 is the default. Higher resolutions take longer to render.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Include voice audio</Label>
            <p className="text-xs text-muted-foreground">Mixes per-canvas voice with trims, cuts, fades.</p>
          </div>
          <Switch checked={includeAudio} onCheckedChange={setIncludeAudio} disabled={running} />
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <div className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Cloud className="h-4 w-4" /> Renders on your server worker
          </div>
          <Button onClick={startRender} disabled={running}>
            <Film className="mr-2 h-4 w-4" />
            {running ? "Rendering…" : "Start export"}
          </Button>
        </div>

        {job && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-muted-foreground">Job {job.id.slice(0, 8)}</span>
              <span className="capitalize font-medium flex items-center gap-1">
                {job.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                {(job.status === "failed" || job.status === "error" || job.status === "cancelled") && <XCircle className="h-3.5 w-3.5 text-destructive" />}
                {job.status}
              </span>
            </div>
            {job.status !== "done" && job.status !== "failed" && job.status !== "error" && job.status !== "cancelled" && (
              <>
                <Progress value={job.progress} />
                <div className="text-xs text-muted-foreground text-right">{job.progress}%</div>
              </>
            )}
            {job.status === "done" && job.output_url && (
              <div className="flex items-center gap-2">
                <Button asChild size="sm">
                  <a href={job.output_url} download={`${baseName}-${quality}.mp4`}>
                    <Download className="mr-2 h-4 w-4" /> Download MP4
                  </a>
                </Button>
                <a
                  href={job.output_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground underline"
                >
                  Open in new tab
                </a>
              </div>
            )}
            {(job.status === "failed" || job.status === "error" || job.status === "cancelled") && job.error && (
              <p className="text-xs text-destructive whitespace-pre-wrap">{job.error}</p>
            )}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Renders run on your dedicated worker (Remotion + Chromium + ffmpeg). Each frame is computed
        deterministically — no realtime browser recording, no dropped frames.
      </p>
    </div>
  );
}
