import { bundle } from "@remotion/bundler";
import {
  makeCancelSignal,
  renderMedia,
  selectComposition,
  openBrowser,
} from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { sb, fetchJobBundle, getJobStatus, updateJob } from "./supabase.js";
import { normalizeSceneVoices } from "./normalize-voice.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RES: Record<string, { w: number; h: number; fps: number }> = {
  "720p":    { w: 1280, h: 720,  fps: 30 },
  "1080p":   { w: 1920, h: 1080, fps: 30 },
  "1080p60": { w: 1920, h: 1080, fps: 60 },
  "4k":      { w: 3840, h: 2160, fps: 30 },
  "4k60":    { w: 3840, h: 2160, fps: 60 },
};

// Bundle once, reuse across renders. Re-bundling per render is the #1 perf mistake.
let bundledOnce: string | null = null;

async function getBundle(): Promise<string> {
  if (bundledOnce) return bundledOnce;
  bundledOnce = await bundle({
    entryPoint: path.resolve(__dirname, "../remotion/index.ts"),
    // Serve the main app's /public so scene backgrounds like
    // "/themes/firebase/bg-orange.svg" resolve inside the Remotion bundle.
    publicDir: path.resolve(__dirname, "../../public"),
    webpackOverride: (c) => c,
  });
  return bundledOnce;
}

export async function runRender(jobId: string) {
  await updateJob(jobId, { status: "rendering", progress: 1 });

  const { job, scenes: rawScenes } = await fetchJobBundle(jobId);
  const scenes = Array.isArray(rawScenes) ? rawScenes : [];
  if (scenes.length === 0) {
    throw new Error(`job ${jobId} has no scenes for project ${job?.project_id}`);
  }

  // Transcode any non-mp3 voice tracks (e.g. browser MediaRecorder .webm/opus)
  // before handing scenes to Remotion — its bundled ffmpeg has no opus decoder.
  await normalizeSceneVoices(scenes);

  const settings = job.settings ?? {};

  const resKey = (settings.resolution as string) ?? "4k60";
  const res = RES[resKey] ?? RES["4k60"];
  const crf =
    settings.quality === "max"
      ? 12
      : settings.quality === "high"
      ? 16
      : 20;

  const totalMs =
    scenes.reduce(
      (sum: number, s: any) => sum + (s?.duration_ms ?? 4000),
      0,
    ) || 4000;
  const durationInFrames = Math.max(
    res.fps,
    Math.round((totalMs / 1000) * res.fps),
  );

  const inputProps = {
    scenes,
    includeAudio: settings.includeAudio !== false,
    width: res.w,
    height: res.h,
    fps: res.fps,
  };

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "render-"));
  const outPath = path.join(outDir, `${jobId}.mp4`);

  await updateJob(jobId, { progress: 5 });

  const serveUrl = await getBundle();

  await updateJob(jobId, { progress: 12 });

  const fsSync = await import("node:fs");
  const candidates = [
    process.env.REMOTION_CHROME_EXECUTABLE,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean) as string[];
  const chromePath = candidates.find((p) => {
    try { return fsSync.existsSync(p); } catch { return false; }
  });

  // 4K frames are ~4x the pixels of 1080p; running multiple in parallel
  // routinely OOMs Chromium → "Session closed. Most likely the page has been closed".
  // Default every render to serial frames on small hosts; allow override via env.
  const is4k = res.w >= 3840;
  let renderConcurrency = Number(
    process.env.RENDER_CONCURRENCY ?? 1,
  );
  if (is4k) renderConcurrency = Math.min(renderConcurrency, 1);

  const isSessionClosed = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    return /Session closed|Target closed|page has been closed|Protocol error/i.test(
      msg,
    );
  };

  const renderOnce = async () => {
    const { cancelSignal, cancel } = makeCancelSignal();
    let lastCancelCheck = 0;
    let cancelledByJobStatus = false;
    const checkForStop = () => {
      const now = Date.now();
      if (now - lastCancelCheck < 3_000) return;
      lastCancelCheck = now;
      void getJobStatus(jobId).then((status) => {
        if (status && status !== "pending" && status !== "rendering") {
          cancelledByJobStatus = true;
          cancel();
        }
      });
    };

    const browser = await openBrowser("chrome", {
      browserExecutable: chromePath ?? null,
      chromiumOptions: {
        gl: "swangle",
        ignoreCertificateErrors: false,
        headless: true,
        enableMultiProcessOnLinux: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      },
    });

    try {
      const composition = await selectComposition({
        serveUrl,
        id: "main",
        inputProps,
        puppeteerInstance: browser,
      });

      await renderMedia({
        composition: {
          ...composition,
          width: res.w,
          height: res.h,
          fps: res.fps,
          durationInFrames,
        },
        serveUrl,
        codec: "h264",
        crf,
        pixelFormat: "yuv420p",
        audioCodec: "aac",
        audioBitrate: "320k",
        enforceAudioTrack: true,
        outputLocation: outPath,
        inputProps,
        puppeteerInstance: browser,
        concurrency: renderConcurrency,
        cancelSignal,
        timeoutInMilliseconds: 180_000,
        chromiumOptions: {
          gl: "swangle",
          headless: true,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        },
        onProgress: ({ progress }) => {
          checkForStop();
          const pct = Math.min(95, 12 + Math.round(progress * 80));
          void updateJob(jobId, { progress: pct });
        },
      });
      if (cancelledByJobStatus) {
        throw new Error("renderMedia() got cancelled");
      }
    } finally {
      await browser.close({ silent: true }).catch(() => {});
    }
  };

  try {
    await renderOnce();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cancelled/i.test(msg)) {
      await fs.rm(outDir, { recursive: true, force: true });
      return;
    }
    if (isSessionClosed(err)) {
      console.warn(
        `render ${jobId}: chromium session closed (likely OOM at ${resKey}); retrying once with concurrency=1`,
      );
      await updateJob(jobId, { progress: 12 });
      // Retry serially — gives the OS time to reclaim memory.
      await new Promise((r) => setTimeout(r, 2000));
      // Force concurrency=1 on retry by mutating env for the duration of this call.
      renderConcurrency = 1;
      try {
        await renderOnce();
      } finally {
        renderConcurrency = 1;
      }
    } else {
      throw err;
    }
  }

  await updateJob(jobId, { progress: 96 });

  const bytes = await fs.readFile(outPath);
  const storagePath = `renders/${jobId}.mp4`;
  const { error: upErr } = await sb.storage
    .from("animation-cache")
    .upload(storagePath, bytes, {
      contentType: "video/mp4",
      upsert: true,
    });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  const { data: pub } = sb.storage
    .from("animation-cache")
    .getPublicUrl(storagePath);

  await updateJob(jobId, {
    status: "done",
    progress: 100,
    output_url: pub.publicUrl,
  });

  await fs.rm(outDir, { recursive: true, force: true });
}
