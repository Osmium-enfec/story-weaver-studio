import express from "express";
import { z } from "zod";
import { runRender } from "./render.js";
import { updateJob } from "./supabase.js";
import { startQueueLoop, claimJob, releaseJob } from "./queue.js";
import { transcodeStorageVideo } from "./transcode.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const SECRET = process.env.RENDER_WORKER_SECRET;

if (!SECRET) console.warn("⚠️  RENDER_WORKER_SECRET not set");

app.get("/", (_req, res) =>
  res.json({ ok: true, service: "render-worker", version: "1.1.0" }),
);
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

const RenderBody = z.object({ jobId: z.string().uuid() });

/**
 * On-demand render trigger. The Lovable app calls this immediately after
 * inserting a render_jobs row so we don't have to wait for the polling tick.
 */
app.post("/render", (req, res) => {
  if (req.header("x-worker-secret") !== SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const parsed = RenderBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  const { jobId } = parsed.data;

  if (!claimJob(jobId)) {
    return res.json({
      ok: true,
      jobId,
      note: "already inflight or worker at capacity; will be picked up by queue",
    });
  }

  res.json({ ok: true, jobId });

  runRender(jobId)
    .catch(async (err) => {
      console.error("render failed", jobId, err);
      await updateJob(jobId, {
        status: "failed",
        error: String(err?.message ?? err),
      });
    })
    .finally(() => releaseJob(jobId));
});

const PORT = Number(process.env.PORT ?? 8080);
app.listen(PORT, () => {
  console.log(`render-worker listening on :${PORT}`);
  startQueueLoop().catch((err) =>
    console.error("queue loop crashed", err),
  );
});
