// Deterministic frame-by-frame video exporter using WebCodecs + mp4-muxer.
//
// Why this exists:
// The previous exporter used MediaRecorder on canvas.captureStream(), which
// records the canvas in REAL TIME. html-to-image snapshots at 1280×720 take
// 50–200 ms each, but a 30 fps recorder samples the canvas every 33 ms — so
// most of the time it captured a stale/blank canvas, producing white frames
// at the start and visible stutter throughout. Audio also drifted because it
// played in real time while the visual loop fell behind.
//
// This module instead encodes each frame at its EXACT virtual timestamp,
// regardless of how long the snapshot took. Output is a real MP4 (H.264 +
// AAC) ready to download — no ffmpeg.wasm transcode pass.

import { toCanvas } from "html-to-image";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { DESIGN } from "@/lib/grid";
import {
  prepareScenesAudio,
  type SceneAudioInput,
  type ScheduledSceneAudio,
} from "@/lib/audio-graph";

export interface DeterministicScene extends SceneAudioInput {
  id: string;
  mount: () => Promise<HTMLElement>;
  unmount?: () => void;
}

export interface DeterministicOptions {
  scenes: DeterministicScene[];
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  includeAudio: boolean;
  signal?: AbortSignal;
  onProgress?: (info: { sceneIndex: number; sceneCount: number; pct: number; phase: string }) => void;
  onPlayingScene?: (sceneId: string | null) => void;
  /**
   * Drives the React state in the off-screen stage so element visibility,
   * opacity and transform reflect `currentMs` deterministically. Implementer
   * MUST flush React synchronously (via flushSync) so the DOM is updated
   * before this resolves.
   */
  onSceneTime: (sceneId: string, currentMs: number) => void;
}

export function isDeterministicExportSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof window.VideoEncoder === "function" &&
    typeof window.VideoFrame === "function" &&
    typeof OffscreenCanvas === "function"
  );
}

async function preloadFonts() {
  const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  if (fonts) {
    try { await fonts.ready; } catch { /* ignore */ }
  }
}

async function preloadImagesIn(node: HTMLElement) {
  const imgs = Array.from(node.querySelectorAll("img")) as HTMLImageElement[];
  await Promise.all(
    imgs.map(async (img) => {
      try {
        if (img.complete && img.naturalWidth > 0) return;
        await new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        });
        if ("decode" in img) await img.decode().catch(() => {});
      } catch { /* best-effort */ }
    }),
  );
}

function pickVideoCodec(width: number, height: number): { mp4: "avc"; codecString: string } {
  // AVC Main profile, level 4.0 — covers up to 1920×1080@30. Use 4.2 for 60fps.
  // 0x4D = Main, 0x40 = level 4.0, 0x42 = level 4.2.
  // Keep it simple: Main 4.2 works everywhere modern.
  void width; void height;
  return { mp4: "avc", codecString: "avc1.4D4028" };
}

async function bakeMixedAudio(
  scheduled: ScheduledSceneAudio[],
  totalSec: number,
): Promise<AudioBuffer | null> {
  if (totalSec <= 0) return null;
  const hasAny = scheduled.some((s) => s.buffer);
  if (!hasAny) return null;
  const sampleRate = 48000;
  const channels = 2;
  const totalFrames = Math.ceil(totalSec * sampleRate);
  const offline = new OfflineAudioContext(channels, totalFrames, sampleRate);
  for (const entry of scheduled) {
    if (!entry.buffer) continue;
    const node = offline.createBufferSource();
    node.buffer = entry.buffer;
    node.connect(offline.destination);
    node.start(entry.startSec);
  }
  return await offline.startRendering();
}

async function encodeAudio(
  buffer: AudioBuffer,
  muxer: Muxer<ArrayBufferTarget>,
  signal?: AbortSignal,
): Promise<void> {
  if (typeof window.AudioEncoder !== "function" || typeof window.AudioData !== "function") return;
  const sampleRate = buffer.sampleRate;
  const channels = Math.min(2, buffer.numberOfChannels);
  const config: AudioEncoderConfig = {
    codec: "mp4a.40.2",
    sampleRate,
    numberOfChannels: channels,
    bitrate: 128_000,
  };
  try {
    const support = await window.AudioEncoder.isConfigSupported(config);
    if (!support.supported) return;
  } catch { return; }

  const encoder = new window.AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => console.warn("AudioEncoder error", e),
  });
  encoder.configure(config);

  // Interleave channel data into a single Float32Array for AudioData.
  // Use 1024-sample chunks for good encoder pacing.
  const chunkSize = 1024;
  const totalFrames = buffer.length;
  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : left;

  for (let offset = 0; offset < totalFrames; offset += chunkSize) {
    if (signal?.aborted) break;
    const frames = Math.min(chunkSize, totalFrames - offset);
    const interleaved = new Float32Array(frames * channels);
    for (let i = 0; i < frames; i++) {
      interleaved[i * channels] = left[offset + i] ?? 0;
      if (channels > 1) interleaved[i * channels + 1] = right[offset + i] ?? 0;
    }
    const ts = Math.round((offset / sampleRate) * 1_000_000);
    const data = new window.AudioData({
      format: "f32",
      sampleRate,
      numberOfFrames: frames,
      numberOfChannels: channels,
      timestamp: ts,
      data: interleaved,
    });
    encoder.encode(data);
    data.close();
  }
  await encoder.flush();
  encoder.close();
}

export async function exportDeterministic(opts: DeterministicOptions): Promise<Blob> {
  const { scenes, width, height, fps, videoBitrate, includeAudio, signal } = opts;
  if (scenes.length === 0) throw new Error("No scenes to export");

  // Fonts ready before we ever snapshot.
  await preloadFonts();

  // ---------------- audio bake (non-blocking for video setup) ----------------
  const totalSec = scenes.reduce((s, sc) => s + sc.duration_ms, 0) / 1000;
  let audioBuffer: AudioBuffer | null = null;
  let audioCfg: AudioEncoderConfig | null = null;
  if (includeAudio) {
    opts.onProgress?.({ sceneIndex: 0, sceneCount: scenes.length, pct: 1, phase: "Preparing audio" });
    const Ctor: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    try {
      const scheduled = await prepareScenesAudio(ctx, scenes);
      audioBuffer = await bakeMixedAudio(scheduled, totalSec);
      if (audioBuffer) {
        audioCfg = {
          codec: "mp4a.40.2",
          sampleRate: audioBuffer.sampleRate,
          numberOfChannels: Math.min(2, audioBuffer.numberOfChannels),
          bitrate: 128_000,
        };
        try {
          const support = await window.AudioEncoder?.isConfigSupported(audioCfg);
          if (!support?.supported) audioCfg = null;
        } catch { audioCfg = null; }
      }
    } finally {
      try { await ctx.close(); } catch { /* ignore */ }
    }
  }

  // ---------------- muxer + video encoder setup ----------------
  const codec = pickVideoCodec(width, height);
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    fastStart: "in-memory",
    video: {
      codec: codec.mp4,
      width,
      height,
      frameRate: fps,
    },
    ...(audioCfg
      ? {
          audio: {
            codec: "aac" as const,
            numberOfChannels: audioCfg.numberOfChannels,
            sampleRate: audioCfg.sampleRate,
          },
        }
      : {}),
  });

  const videoEncoder = new window.VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("VideoEncoder", e),
  });
  videoEncoder.configure({
    codec: codec.codecString,
    width,
    height,
    bitrate: videoBitrate,
    framerate: fps,
  });

  // Scratch canvas to scale the design-space snapshot up to the export
  // resolution (DESIGN is 1280×720, export may be 1920×1080).
  const scratch = new OffscreenCanvas(width, height);
  const sctx = scratch.getContext("2d", { alpha: false });
  if (!sctx) throw new Error("OffscreenCanvas 2D context unavailable");
  sctx.fillStyle = "#ffffff";
  sctx.fillRect(0, 0, width, height);

  const frameInterval = 1000 / fps;
  let cumulativeMs = 0;
  let totalFrames = 0;
  const grandTotalFrames = scenes.reduce((s, sc) => s + Math.round((sc.duration_ms / 1000) * fps), 0);

  try {
    for (let i = 0; i < scenes.length; i++) {
      if (signal?.aborted) throw new Error("Aborted");
      const scene = scenes[i];

      opts.onPlayingScene?.(scene.id);
      // Pre-paint frame 0 of this scene before we start encoding it.
      opts.onSceneTime(scene.id, 0);
      const node = await scene.mount();
      // Two rAFs + a microtask to make sure React has committed and the
      // browser has painted before we snapshot.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      await preloadImagesIn(node);
      await new Promise((r) => requestAnimationFrame(() => r(null)));

      const sceneFrames = Math.max(1, Math.round((scene.duration_ms / 1000) * fps));

      for (let f = 0; f < sceneFrames; f++) {
        if (signal?.aborted) throw new Error("Aborted");
        const localMs = Math.min(scene.duration_ms, Math.round(f * frameInterval));
        opts.onSceneTime(scene.id, localMs);
        // Wait for React commit + paint.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));

        let snap: HTMLCanvasElement;
        try {
          snap = await toCanvas(node, {
            cacheBust: false,
            pixelRatio: 1,
            width: DESIGN.w,
            height: DESIGN.h,
            backgroundColor: "#ffffff",
            skipFonts: true,
          });
        } catch (err) {
          console.warn("snapshot failed at frame", totalFrames, err);
          // Reuse last contents of scratch (will be re-encoded).
          snap = (await toCanvas(node, {
            cacheBust: false,
            pixelRatio: 1,
            width: DESIGN.w,
            height: DESIGN.h,
            backgroundColor: "#ffffff",
            skipFonts: true,
          }).catch(() => null)) as HTMLCanvasElement;
          if (!snap) {
            sctx.fillStyle = "#ffffff";
            sctx.fillRect(0, 0, width, height);
          }
        }
        if (snap) {
          sctx.drawImage(snap, 0, 0, width, height);
        }

        const tsUs = Math.round((cumulativeMs + localMs) * 1000);
        // Wrap the OffscreenCanvas in a VideoFrame.
        const vf = new window.VideoFrame(scratch, { timestamp: tsUs });
        // Force a keyframe every ~2s and at scene boundaries.
        const keyFrame = f === 0 || totalFrames % (fps * 2) === 0;
        videoEncoder.encode(vf, { keyFrame });
        vf.close();
        totalFrames++;

        // Backpressure: the encoder queue can grow if we feed too fast.
        if (videoEncoder.encodeQueueSize > fps * 2) {
          await new Promise((r) => setTimeout(r, 5));
        }

        opts.onProgress?.({
          sceneIndex: i,
          sceneCount: scenes.length,
          pct: Math.min(98, 5 + Math.round((totalFrames / grandTotalFrames) * 90)),
          phase: `Rendering scene ${i + 1} / ${scenes.length}`,
        });
      }

      cumulativeMs += scene.duration_ms;
      scene.unmount?.();
    }

    opts.onProgress?.({ sceneIndex: scenes.length, sceneCount: scenes.length, pct: 96, phase: "Finalizing video" });
    await videoEncoder.flush();
    videoEncoder.close();

    if (audioBuffer && audioCfg) {
      opts.onProgress?.({ sceneIndex: scenes.length, sceneCount: scenes.length, pct: 98, phase: "Encoding audio" });
      await encodeAudio(audioBuffer, muxer, signal);
    }

    muxer.finalize();
    const buf = muxer.target.buffer;
    opts.onProgress?.({ sceneIndex: scenes.length, sceneCount: scenes.length, pct: 100, phase: "Done" });
    return new Blob([buf], { type: "video/mp4" });
  } finally {
    opts.onPlayingScene?.(null);
    if (videoEncoder.state !== "closed") {
      try { videoEncoder.close(); } catch { /* ignore */ }
    }
  }
}
