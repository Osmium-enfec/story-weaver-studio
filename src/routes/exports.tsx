import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { listAllRenderJobs } from "@/server/render-jobs.functions";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/exports")({
  component: ExportsPage,
});

type Job = Awaited<ReturnType<typeof listAllRenderJobs>>["jobs"][number];

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "done") return "default";
  if (status === "error" || status === "failed") return "destructive";
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

function ExportsPage() {
  const list = useServerFn(listAllRenderJobs);
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
          <Section title={`In progress (${active.length})`} jobs={active} />
          <Section title={`Recent (${finished.length})`} jobs={finished} />
        </>
      )}
    </div>
  );
}

function Section({ title, jobs }: { title: string; jobs: Job[] }) {
  if (!jobs.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="space-y-2">
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} />
        ))}
      </div>
    </section>
  );
}

function JobRow({ job }: { job: Job }) {
  const isDone = job.status === "done" && !!job.output_url;
  const isError = job.status === "error" || job.status === "failed";
  const isActive = job.status === "pending" || job.status === "rendering";
  const resolution = (job.settings as { resolution?: string } | null)?.resolution ?? "—";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              to="/projects/$projectId/export"
              params={{ projectId: job.project_id as string }}
              className="truncate font-medium hover:underline"
            >
              {job.project_title}
            </Link>
            <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
            <span className="text-xs text-muted-foreground">{resolution}</span>
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
        </div>
      </div>
    </div>
  );
}
