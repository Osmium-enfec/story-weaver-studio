import { sb, updateJob } from "./supabase.js";
import { runRender } from "./render.js";

const POLL_INTERVAL_MS = Number(process.env.QUEUE_POLL_MS ?? 5_000);
const MAX_PARALLEL = Number(process.env.RENDER_CONCURRENCY ?? 1);
const inflight = new Set<string>();

/**
 * Polling loop fallback. The app also pings POST /render directly when a job
 * is enqueued, but if that ping fails (worker offline, transient network),
 * this loop guarantees the job eventually runs.
 */
export async function startQueueLoop() {
  // On boot, recover any jobs marked "rendering" from a previous (now-dead) instance.
  // Safe only when running a single worker. With multiple workers, switch to a
  // worker_id + heartbeat claim pattern.
  await sb
    .from("render_jobs")
    .update({ status: "pending", progress: 0 })
    .eq("status", "rendering");

  setInterval(tick, POLL_INTERVAL_MS);
  // run once immediately
  tick().catch(() => {});
}

export function claimJob(jobId: string): boolean {
  if (inflight.has(jobId)) return false;
  if (inflight.size >= MAX_PARALLEL) return false;
  inflight.add(jobId);
  return true;
}

export function releaseJob(jobId: string) {
  inflight.delete(jobId);
}

async function tick() {
  if (inflight.size >= MAX_PARALLEL) return;
  const need = MAX_PARALLEL - inflight.size;

  const { data: jobs, error } = await sb
    .from("render_jobs")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(need);

  if (error) {
    console.error("queue poll error", error.message);
    return;
  }

  for (const j of jobs ?? []) {
    if (!claimJob(j.id)) continue;
    runRender(j.id)
      .catch(async (err) => {
        console.error("render failed", j.id, err);
        await updateJob(j.id, {
          status: "failed",
          error: String(err?.message ?? err),
        });
      })
      .finally(() => releaseJob(j.id));
  }
}
