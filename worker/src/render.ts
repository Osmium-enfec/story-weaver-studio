import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  selectComposition,
  openBrowser,
} from "@remotion/renderer";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { fetchJob, postUpdate } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RESOLUTIONS: Record<string, { w: number; h: number }> = {
  "720p": { w: 1280, h: 720 },
  "1080p": { w: 1920, h: 1080 },
  "4k": { w: 3840, h: 2160 },
};

export async function runRender(jobId: string) {
  await postUpdate(jobId, { status: "rendering", progress: 1 });

  const { job, scenes } = await fetchJob(jobId);
  const settings = job.settings ?? {};
  const res = RESOLUTIONS[settings.resolution as string] ?? RESOLUTIONS["1080p"];

  // Total frames @ 30fps: sum of scene durations
  const fps = 30;
  const totalMs = scenes.reduce(
    (sum: number, s: any) => sum + (s.duration_ms ?? 5000),
    0,
  ) || 5000;
  const durationInFrames = Math.max(30, Math.round((totalMs / 1000) * fps));

  const inputProps = { scenes, project: job.projects ?? null };

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "render-"));
  const outPath = path.join(outDir, `${jobId}.mp4`);

  await postUpdate(jobId, { progress: 5 });

  const bundled = await bundle({
    entryPoint: path.resolve(__dirname, "../remotion/index.ts"),
    webpackOverride: (c) => c,
  });

  await postUpdate(jobId, { progress: 15 });

  const browser = await openBrowser("chrome", {
    browserExecutable:
      process.env.REMOTION_CHROME_EXECUTABLE ?? "/usr/bin/chromium",
    chromiumOptions: {
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    },
  });

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "main",
    inputProps,
    puppeteerInstance: browser,
  });

  await renderMedia({
    composition: {
      ...composition,
      width: res.w,
      height: res.h,
      fps,
      durationInFrames,
    },
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outPath,
    inputProps,
    puppeteerInstance: browser,
    concurrency: 1,
    onProgress: ({ progress }) => {
      // 15..90 range during render
      const p = 15 + Math.round(progress * 75);
      postUpdate(jobId, { progress: p }).catch(() => {});
    },
  });

  await browser.close({ silent: false });

  await postUpdate(jobId, { progress: 92 });

  // Upload to Lovable Cloud Storage
  const fileBytes = await fs.readFile(outPath);
  const storagePath = `renders/${jobId}.mp4`;
  const { error: upErr } = await sb.storage
    .from("animation-cache")
    .upload(storagePath, fileBytes, {
      contentType: "video/mp4",
      upsert: true,
    });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  const { data: pub } = sb.storage
    .from("animation-cache")
    .getPublicUrl(storagePath);

  await postUpdate(jobId, {
    status: "done",
    progress: 100,
    outputUrl: pub.publicUrl,
  });

  await fs.rm(outDir, { recursive: true, force: true });
}
