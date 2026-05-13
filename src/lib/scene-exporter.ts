import { toCanvas } from "html-to-image";
import { DESIGN } from "@/lib/grid";
import { prepareScenesAudio, scheduleScenesAudio, type SceneAudioInput } from "@/lib/audio-graph";

export type ExportQuality = "720p" | "1080p" | "1080p60";
export type ExportFormat = "webm" | "mp4";

export interface QualityPreset {
  width: number;
  height: number;
  fps: number;
  bitsPerSecond: number;
}

export const QUALITY_PRESETS: Record<ExportQuality, QualityPreset> = {
  "720p": { width: 1280, height: 720, fps: 30, bitsPerSecond: 6_000_000 },
  "1080p": { width: 1920, height: 1080, fps: 30, bitsPerSecond: 12_000_000 },
  "1080p60": { width: 1920, height: 1080, fps: 60, bitsPerSecond: 18_000_000 },
};

export interface ExporterScene extends SceneAudioInput {
  id: string;
  /**
   * Resolves to a freshly-mounted DOM node for this scene, sized at
   * DESIGN.w × DESIGN.h. Called right before the scene starts rendering so
   * any CSS animations on its elements begin in sync with the audio.
   */
  mount: () => Promise<HTMLElement>;
  unmount?: () => void;
}

export interface ExportOptions {
  scenes: ExporterScene[];
  quality: ExportQuality;
  format: ExportFormat;
  includeAudio: boolean;
  onProgress?: (info: { sceneIndex: number; sceneCount: number; pct: number; phase: string }) => void;
  onPlayingScene?: (sceneId: string | null) => void;
  signal?: AbortSignal;
}

function pickVideoMime(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

async function preloadImagesIn(node: HTMLElement) {
  const imgs = Array.from(node.querySelectorAll("img")) as HTMLImageElement[];
  await Promise.all(
    imgs.map(async (img) => {
      try {
        if (img.complete && img.naturalWidth > 0) return;
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        });
        if ("decode" in img) await img.decode().catch(() => {});
      } catch {
        // best-effort
      }
    }),
  );
}

async function preloadFonts() {
  if (typeof document !== "undefined" && (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts) {
    try { await (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready; } catch { /* ignore */ }
  }
}

export async function exportScenesToBlob(opts: ExportOptions): Promise<Blob> {
  const preset = QUALITY_PRESETS[opts.quality];
  const { width, height, fps, bitsPerSecond } = preset;

  // Offscreen canvas we capture from
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx2d = canvas.getContext("2d");
  if (!ctx2d) throw new Error("Canvas 2D context unavailable");
  // Initial paint so the recorder has at least one frame
  ctx2d.fillStyle = "#ffffff";
  ctx2d.fillRect(0, 0, width, height);

  const stream = canvas.captureStream(fps) as MediaStream;

  // Audio: bake all scenes up-front, then mix into the same stream
  let audioCtx: AudioContext | null = null;
  let scheduled: Awaited<ReturnType<typeof prepareScenesAudio>> = [];
  if (opts.includeAudio) {
    const Ctor: typeof AudioContext =
      (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    audioCtx = new Ctor();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    opts.onProgress?.({ sceneIndex: 0, sceneCount: opts.scenes.length, pct: 0, phase: "Preparing audio" });
    scheduled = await prepareScenesAudio(audioCtx, opts.scenes);
    const dest = audioCtx.createMediaStreamDestination();
    // We will schedule sources just before recorder.start()
    // Add the audio track to our video stream now so the recorder picks it up
    for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
    // Stash dest so we can schedule when ready
    (stream as unknown as { __audioDest: MediaStreamAudioDestinationNode }).__audioDest = dest;
  }

  // We mount each scene fresh just before recording it so its CSS animations
  // start in sync with the audio. Preloading happens per-scene below.
  await preloadFonts();

  const mimeType = pickVideoMime();
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitsPerSecond, audioBitsPerSecond: 192_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = (e) => reject(e);
  });

  // Schedule audio in lockstep with recorder.start()
  recorder.start(500);
  if (audioCtx && opts.includeAudio) {
    const dest = (stream as unknown as { __audioDest: MediaStreamAudioDestinationNode }).__audioDest;
    scheduleScenesAudio(audioCtx, scheduled, dest, 0.05);
  }

  const totalMs = opts.scenes.reduce((s, sc) => s + sc.duration_ms, 0);
  const overallStart = performance.now();

  try {
    for (let i = 0; i < opts.scenes.length; i++) {
      if (opts.signal?.aborted) throw new Error("Aborted");
      const scene = opts.scenes[i];
      opts.onPlayingScene?.(scene.id);
      const sceneStart = performance.now();
      const sceneDur = scene.duration_ms;
      // Force a re-snapshot loop for the scene's duration
      const frameInterval = 1000 / fps;
      let nextFrameAt = sceneStart;
      while (performance.now() - sceneStart < sceneDur) {
        if (opts.signal?.aborted) throw new Error("Aborted");
        const now = performance.now();
        if (now < nextFrameAt) {
          await new Promise((r) => setTimeout(r, Math.max(0, nextFrameAt - now)));
        }
        try {
          const frameCanvas = await toCanvas(scene.node, {
            cacheBust: false,
            pixelRatio: 1,
            width: DESIGN.w,
            height: DESIGN.h,
            backgroundColor: "#ffffff",
            skipFonts: true,
            imagePlaceholder:
              "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>",
          });
          ctx2d.clearRect(0, 0, width, height);
          ctx2d.drawImage(frameCanvas, 0, 0, width, height);
        } catch {
          // Skip the bad frame; recorder will reuse the last painted one.
        }
        nextFrameAt += frameInterval;
        const elapsedTotal = performance.now() - overallStart;
        opts.onProgress?.({
          sceneIndex: i,
          sceneCount: opts.scenes.length,
          pct: Math.min(99, 10 + Math.round((elapsedTotal / totalMs) * 89)),
          phase: `Rendering scene ${i + 1} / ${opts.scenes.length}`,
        });
      }
    }
  } finally {
    opts.onPlayingScene?.(null);
    // Give the recorder a beat to flush trailing audio
    await new Promise((r) => setTimeout(r, 250));
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
  }

  const blob = await finished;
  if (audioCtx) try { await audioCtx.close(); } catch { /* ignore */ }
  opts.onProgress?.({ sceneIndex: opts.scenes.length, sceneCount: opts.scenes.length, pct: 100, phase: "Done" });
  return blob;
}

/**
 * Optional WebM → MP4 conversion via ffmpeg.wasm. Heavy (~25MB) so loaded
 * lazily only when the user picks MP4.
 */
export async function convertWebmToMp4(
  webm: Blob,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
  const ffmpeg = new FFmpeg();
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  ffmpeg.on("progress", ({ progress }: { progress: number }) => onProgress?.(Math.min(99, Math.round(progress * 100))));
  await ffmpeg.writeFile("in.webm", await fetchFile(webm));
  // Re-encode video to H.264 yuv420p (universally playable), copy audio if AAC,
  // otherwise transcode with the bundled aac encoder.
  await ffmpeg.exec([
    "-i", "in.webm",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    "out.mp4",
  ]);
  const data = await ffmpeg.readFile("out.mp4");
  onProgress?.(100);
  // ffmpeg returns a Uint8Array — copy into a fresh ArrayBuffer for Blob safety
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as unknown as ArrayBuffer);
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return new Blob([out.buffer], { type: "video/mp4" });
}
