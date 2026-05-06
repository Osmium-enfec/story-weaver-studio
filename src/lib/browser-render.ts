import type { Scene } from "@/lib/db-types";

export interface BrowserRenderOptions {
  scenes: Scene[];
  width?: number;
  height?: number;
  fps?: number;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}

/**
 * Client-side renderer: draws each scene onto a canvas and captures
 * a WebM video via MediaRecorder. Lower quality than a real Remotion
 * render but requires zero backend infrastructure.
 */
export async function renderInBrowser(
  opts: BrowserRenderOptions,
): Promise<Blob> {
  const {
    scenes,
    width = 1920,
    height = 1080,
    fps = 30,
    onProgress,
    signal,
  } = opts;

  if (!scenes.length) throw new Error("No scenes to render");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  const stream = canvas.captureStream(fps);
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 4_000_000, // ~4 Mbps — good "low quality 1080p"
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = (e) => reject(e);
  });

  recorder.start(250);

  const totalMs = scenes.reduce((s, sc) => s + (sc.duration_ms ?? 3000), 0);
  let elapsed = 0;
  const startedAt = performance.now();

  for (let i = 0; i < scenes.length; i++) {
    if (signal?.aborted) break;
    const scene = scenes[i];
    const dur = scene.duration_ms ?? 3000;
    const sceneStart = performance.now();

    while (performance.now() - sceneStart < dur) {
      if (signal?.aborted) break;
      const localT = (performance.now() - sceneStart) / dur; // 0..1
      drawScene(ctx, scene, i, scenes.length, localT, width, height);
      const totalElapsed = performance.now() - startedAt;
      onProgress?.(Math.min(99, Math.round((totalElapsed / totalMs) * 100)));
      await nextFrame();
    }
    elapsed += dur;
  }

  recorder.stop();
  stream.getTracks().forEach((t) => t.stop());
  const blob = await done;
  onProgress?.(100);
  return blob;
}

function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "video/webm";
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  index: number,
  total: number,
  t: number, // 0..1 within scene
  W: number,
  H: number,
) {
  // Background
  const bg = (scene.background as { value?: string } | null)?.value ?? "#0f172a";
  if (bg.startsWith("linear-gradient")) {
    // crude gradient parse: use first two hex colors found
    const colors = bg.match(/#[0-9a-fA-F]{3,8}/g) ?? ["#0f172a", "#1e293b"];
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(1, colors[1] ?? colors[0]);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = bg;
  }
  ctx.fillRect(0, 0, W, H);

  // Subtle ken-burns-ish vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.8);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // Animation tag pill
  if (scene.suggested_animation) {
    const pillFade = easeOut(Math.min(1, t * 4));
    ctx.globalAlpha = pillFade;
    const text = String(scene.suggested_animation).toUpperCase();
    ctx.font = "600 28px system-ui, -apple-system, sans-serif";
    const tw = ctx.measureText(text).width;
    const px = 40;
    const py = 18;
    const x = W / 2 - (tw + px * 2) / 2;
    const y = H * 0.32;
    roundedRect(ctx, x, y, tw + px * 2, 28 + py * 2, 999);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + px, y + (28 + py * 2) / 2);
    ctx.globalAlpha = 1;
  }

  // Narration text — fade + slight upward motion
  const narration = scene.narration ?? "";
  const enter = easeOut(Math.min(1, t * 3));
  const exit = t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1;
  ctx.globalAlpha = enter * exit;
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 64px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const yOffset = (1 - enter) * 30;
  wrapText(ctx, narration, W / 2, H / 2 + yOffset, W * 0.8, 80);
  ctx.globalAlpha = 1;
  ctx.textAlign = "start";

  // Progress chip bottom-right
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "500 22px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${index + 1} / ${total}`, W - 48, H - 48);
  ctx.textAlign = "start";
}

function easeOut(x: number) {
  return 1 - Math.pow(1 - x, 3);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}
