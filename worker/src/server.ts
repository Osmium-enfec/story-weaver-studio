import express from "express";
import { z } from "zod";
import { runRender } from "./render.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const SECRET = process.env.RENDER_WORKER_SECRET;
const APP_URL = process.env.LOVABLE_APP_URL;

if (!SECRET) console.warn("⚠️  RENDER_WORKER_SECRET not set");
if (!APP_URL) console.warn("⚠️  LOVABLE_APP_URL not set");

app.get("/", (_req, res) => res.json({ ok: true, service: "render-worker" }));

const RenderBody = z.object({ jobId: z.string().uuid() });

app.post("/render", async (req, res) => {
  if (req.header("x-worker-secret") !== SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const parsed = RenderBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  const { jobId } = parsed.data;

  // ack immediately, render in background
  res.json({ ok: true, jobId });

  runRender(jobId).catch(async (err) => {
    console.error("render failed", jobId, err);
    await postUpdate(jobId, {
      status: "failed",
      error: String(err?.message ?? err),
    });
  });
});

export async function postUpdate(
  jobId: string,
  patch: {
    status?: "pending" | "rendering" | "done" | "failed";
    progress?: number;
    outputUrl?: string;
    error?: string;
    log?: string;
  },
) {
  const url = `${APP_URL!.replace(/\/$/, "")}/api/public/render-jobs/update`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-secret": SECRET!,
    },
    body: JSON.stringify({ jobId, ...patch }),
  });
  if (!r.ok) console.error("postUpdate failed", r.status, await r.text());
}

export async function fetchJob(jobId: string) {
  const url = `${APP_URL!.replace(/\/$/, "")}/api/public/render-jobs/${jobId}`;
  const r = await fetch(url, { headers: { "x-worker-secret": SECRET! } });
  if (!r.ok) throw new Error(`fetchJob ${r.status}: ${await r.text()}`);
  return (await r.json()) as { job: any; scenes: any[] };
}

const PORT = Number(process.env.PORT ?? 8080);
app.listen(PORT, () => console.log(`render-worker listening on :${PORT}`));
