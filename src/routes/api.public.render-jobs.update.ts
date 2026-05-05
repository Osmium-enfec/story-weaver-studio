import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const BodySchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(["pending", "rendering", "done", "failed"]).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  outputUrl: z.string().url().optional(),
  error: z.string().max(2000).optional(),
  log: z.string().max(20000).optional(),
});

function admin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export const Route = createFileRoute("/api/public/render-jobs/update")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RENDER_WORKER_SECRET;
        if (!secret) {
          return new Response("worker secret not configured", { status: 500 });
        }
        if (request.headers.get("x-worker-secret") !== secret) {
          return new Response("unauthorized", { status: 401 });
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const parsed = BodySchema.safeParse(body);
        if (!parsed.success) {
          return new Response(parsed.error.message, { status: 400 });
        }
        const { jobId, ...patch } = parsed.data;
        const update: Record<string, unknown> = {};
        if (patch.status) update.status = patch.status;
        if (patch.progress !== undefined) update.progress = patch.progress;
        if (patch.outputUrl) update.output_url = patch.outputUrl;
        if (patch.error !== undefined) update.error = patch.error;
        if (patch.log !== undefined) update.log = patch.log;
        if (patch.status === "done" || patch.status === "failed") {
          update.completed_at = new Date().toISOString();
        }
        const sb = admin();
        const { error } = await sb
          .from("render_jobs")
          .update(update)
          .eq("id", jobId);
        if (error) return new Response(error.message, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
