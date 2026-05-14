import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import {
  listAllRenderJobs,
  cancelRenderJob,
  deleteRenderJob,
} from "@/server/render-jobs.functions";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Download,
  ExternalLink,
  RefreshCw,
  StopCircle,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/exports")({
  component: ExportsPage,
});

type Job = Awaited<ReturnType<typeof listAllRenderJobs>>["jobs"][number];

const STALE_MS = 10 * 60 * 1000; // 10 min with no completion = likely stuck

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "done") return "default";
  if (status === "error" || status === "failed" || status === "cancelled") return "destructive";
  if (status === "rendering" || status === "pending") return "secondary";
  return "outline";
}

function timeAgo(iso?: string | null) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function isStale(job: Job) {
  if (job.status !== "pending" && job.status !== "rendering") return false;
  if (!job.created_at) return false;
  return Date.now() - new Date(job.created_at).getTime() > STALE_MS;
}

function ExportsPage() {
  const list = useServerFn(listAllRenderJobs);
  const cancel = useServerFn(cancelRenderJob);
  const remove = useServerFn(deleteRenderJob);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setFetching(true);
    try {
      const res = await list();
      setJobs(res.jobs);
      setError(null);
      const stale = res.jobs.filter(isStale);
      if (stale.length) {
        toast.warning(
          `${stale.length} render${stale.length > 1 ? "s" : ""} may be stalled (no progress for 10+ min). Stop and re-run if needed.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setFetching(false);
      setLoading(false);
    }
  }, [list]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCancel(jobId: string) {
    try {
      await cancel({ data: { jobId } });
      toast.success("Render stopped");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to stop");
    }
  }

  async function handleDelete(jobId: string) {
    if (!confirm("Delete this export entry? The video file will not be removed.")) return;
    try {
      await remove({ data: { jobId } });
      toast.success("Export deleted");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  const active = jobs.filter((j) => j.status === "pending" || j.status === "rendering");
  const finished = jobs.filter((j) => j.status !== "pending" && j.status !== "rendering");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Exports</h1>
          <p className="text-sm text-muted-foreground">
            Track render progress and download finished videos.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={fetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${fetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No exports yet.</p>
      ) : (
        <>
          <Section
            title={`In progress (${active.length})`}
            jobs={active}
            onCancel={handleCancel}
            onDelete={handleDelete}
          />
          <Section
            title={`Recent (${finished.length})`}
            jobs={finished}
            onCancel={handleCancel}
            onDelete={handleDelete}
          />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  jobs,
  onCancel,
  onDelete,
}: {
  title: string;
  jobs: Job[];
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!jobs.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="space-y-2">
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} onCancel={onCancel} onDelete={onDelete} />
        ))}
      </div>
    </section>
  );
}

function JobRow({
  job,
  onCancel,
  onDelete,
}: {
  job: Job;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isDone = job.status === "done" && !!job.output_url;
  const isError =
    job.status === "error" || job.status === "failed" || job.status === "cancelled";
  const isActive = job.status === "pending" || job.status === "rendering";
  const stale = isStale(job);
  const resolution = (job.settings as { resolution?: string } | null)?.resolution ?? "—";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/projects/$projectId/export"
              params={{ projectId: job.project_id as string }}
              className="truncate font-medium hover:underline"
            >
              {job.project_title}
            </Link>
            <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
            <span className="text-xs text-muted-foreground">{resolution}</span>
            {stale && (
              <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/50">
                <AlertTriangle className="h-3 w-3" /> Stalled
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Started {timeAgo(job.created_at)}
            {job.completed_at ? ` · finished ${timeAgo(job.completed_at)}` : ""}
          </p>
          {isActive && (
            <div className="mt-3 flex items-center gap-3">
              <Progress value={job.progress ?? 0} className="h-2 flex-1" />
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                {job.progress ?? 0}%
              </span>
            </div>
          )}
          {stale && isActive && (
            <p className="mt-2 text-xs text-amber-600">
              No progress for over 10 minutes. The render worker may be offline or
              the job crashed. You can stop it and try again.
            </p>
          )}
          {isError && job.error && (
            <p className="mt-2 text-xs text-destructive line-clamp-2">{job.error}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isDone && job.output_url && (
            <>
              <Button asChild size="sm" variant="outline">
                <a href={job.output_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" /> Open
                </a>
              </Button>
              <Button asChild size="sm">
                <a href={job.output_url} download>
                  <Download className="mr-2 h-4 w-4" /> Download
                </a>
              </Button>
            </>
          )}
          {isActive && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => onCancel(job.id as string)}
            >
              <StopCircle className="mr-2 h-4 w-4" /> Stop
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(job.id as string)}
            title="Delete this export entry"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
