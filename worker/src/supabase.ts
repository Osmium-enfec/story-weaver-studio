import { createClient } from "@supabase/supabase-js";

export const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export interface JobBundle {
  job: any;
  scenes: any[];
}

/**
 * Fetch a render job + its project + every scene with its scene_elements.
 * Service-role client bypasses RLS.
 */
export async function fetchJobBundle(jobId: string): Promise<JobBundle> {
  const { data: job, error } = await sb
    .from("render_jobs")
    .select("*, projects(*)")
    .eq("id", jobId)
    .single();
  if (error || !job) throw new Error(`job ${jobId} not found: ${error?.message}`);

  const sceneIdsFromJob: string[] | null =
    (job as any).scene_ids ?? null;

  let scenesQuery = sb
    .from("scenes")
    .select("*, scene_elements(*)")
    .eq("project_id", job.project_id)
    .order("order_index");

  if (sceneIdsFromJob && sceneIdsFromJob.length) {
    scenesQuery = sb
      .from("scenes")
      .select("*, scene_elements(*)")
      .in("id", sceneIdsFromJob)
      .order("order_index");
  }

  const { data: scenes, error: scErr } = await scenesQuery;
  if (scErr) throw new Error(`scenes fetch: ${scErr.message}`);

  return { job, scenes: scenes ?? [] };
}

export async function updateJob(
  jobId: string,
  patch: Partial<{
    status: "pending" | "queued" | "rendering" | "done" | "failed" | "cancelled";
    progress: number;
    output_url: string;
    error: string;
    log: string;
  }>,
) {
  const update: Record<string, unknown> = { ...patch };
  if (patch.status === "done" || patch.status === "failed") {
    update.completed_at = new Date().toISOString();
  }
  const { error } = await sb.from("render_jobs").update(update).eq("id", jobId);
  if (error) console.error("updateJob error", jobId, error.message);
}
