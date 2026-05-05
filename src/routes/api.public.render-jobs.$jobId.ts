import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

function admin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export const Route = createFileRoute("/api/public/render-jobs/$jobId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const secret = process.env.RENDER_WORKER_SECRET;
        if (!secret || request.headers.get("x-worker-secret") !== secret) {
          return new Response("unauthorized", { status: 401 });
        }
        const sb = admin();
        const { data: job, error } = await sb
          .from("render_jobs")
          .select("*, projects(*)")
          .eq("id", params.jobId)
          .single();
        if (error) return new Response(error.message, { status: 404 });

        const { data: scenes } = await sb
          .from("scenes")
          .select("*, scene_elements(*)")
          .eq("project_id", job.project_id)
          .order("order_index");

        return Response.json({ job, scenes: scenes ?? [] });
      },
    },
  },
});
