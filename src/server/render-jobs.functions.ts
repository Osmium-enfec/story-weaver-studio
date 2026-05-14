import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

function admin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export const enqueueRenderJob = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      projectId: string;
      settings?: Record<string, unknown>;
      renderPlan?: unknown;
    }) => input,
  )
  .handler(async ({ data }) => {
    const sb = admin();
    const { data: job, error } = await sb
      .from("render_jobs")
      .insert({
        project_id: data.projectId,
        status: "pending",
        progress: 0,
        settings: data.settings ?? {},
        render_plan: data.renderPlan ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Best-effort kick to the worker (if configured). Don't block enqueue on it.
    const workerUrl = process.env.RENDER_WORKER_URL;
    const workerSecret = process.env.RENDER_WORKER_SECRET;
    if (workerUrl) {
      try {
        await fetch(`${workerUrl.replace(/\/$/, "")}/render`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(workerSecret ? { "x-worker-secret": workerSecret } : {}),
          },
          body: JSON.stringify({ jobId: job.id }),
        });
      } catch {
        // Worker offline — job stays pending and can be picked up later.
      }
    }
    return { job };
  });

export const listRenderJobs = createServerFn({ method: "GET" })
  .inputValidator((input: { projectId: string }) => input)
  .handler(async ({ data }) => {
    const sb = admin();
    const { data: jobs, error } = await sb
      .from("render_jobs")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return { jobs: jobs ?? [] };
  });

export const listAllRenderJobs = createServerFn({ method: "GET" }).handler(
  async () => {
    const sb = admin();
    const { data: jobs, error } = await sb
      .from("render_jobs")
      .select("id, project_id, status, progress, output_url, error, created_at, completed_at, settings")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    const projectIds = Array.from(
      new Set((jobs ?? []).map((j) => j.project_id).filter(Boolean) as string[]),
    );
    let projectMap: Record<string, string> = {};
    if (projectIds.length) {
      const { data: projects } = await sb
        .from("projects")
        .select("id, title")
        .in("id", projectIds);
      projectMap = Object.fromEntries(
        (projects ?? []).map((p) => [p.id as string, (p.title as string) ?? "Untitled"]),
      );
    }
    return {
      jobs: (jobs ?? []).map((j) => ({
        ...j,
        project_title: projectMap[j.project_id as string] ?? "Untitled project",
      })),
    };
  },
);

export const getRenderJob = createServerFn({ method: "GET" })
  .inputValidator((input: { jobId: string }) => input)
  .handler(async ({ data }) => {
    const sb = admin();
    const { data: job, error } = await sb
      .from("render_jobs")
      .select("id, status, progress, output_url, error, created_at, completed_at")
      .eq("id", data.jobId)
      .single();
    if (error) throw new Error(error.message);
    return { job };
  });
