# Server-Side Render Worker (DigitalOcean)

This document is everything you need to stand up a **production-grade video render
worker** for CodeMotion on a DigitalOcean droplet (or any Linux VM). It replaces
the brittle in-browser `MediaRecorder` / WebCodecs export with a deterministic,
frame-accurate Remotion render running in headless Chromium.

## Why a server worker?

Browser export problems we hit (and why each one is unfixable in the browser):

| Problem in browser export | Root cause | Why a server worker fixes it |
| --- | --- | --- |
| White/blank frames at the start | `html-to-image` snapshots take 50–200 ms; the encoder samples every 33 ms and grabs a stale canvas | Remotion blocks until React commits each frame, then asks the browser for a real screenshot at that exact frame |
| Animations all appear at once | CSS transitions are wall-clock based; virtual time advances faster than wall time | Every animation is `useCurrentFrame()`-driven — deterministic per frame |
| Lottie shows the wrong frame | `DotLottieReact` plays in real time; we capture whatever frame happens to be visible | `@remotion/lottie` exposes the playhead and is driven by `useCurrentFrame()` |
| Iconscout video clips look frozen | `<video>` plays in wall-clock time; `currentTime` not synced to capture | Remotion's `<OffthreadVideo>` extracts the exact frame for each composition frame |
| MP4 conversion fragile (`ffmpeg.wasm`) | WASM ffmpeg breaks under various CSP / SAB / cross-origin setups | Native ffmpeg in the worker emits H.264 + AAC directly |
| Tab must stay open and active | Browsers throttle background tabs | Worker runs server-side, user closes the tab and gets a download link when done |
| Slow on weaker devices | Render speed = user device speed | Renders on a CPU/GPU you control; horizontally scalable |

You already have the scaffolding: `worker/` (Dockerfile, Remotion entry,
`render.ts`, `server.ts`) plus the `render_jobs` Supabase table. This guide
gets it to production.

---

## 1. Architecture

```
┌────────────────┐   POST /render   ┌──────────────────┐   pulls scenes    ┌────────────┐
│  Lovable app   │ ───────────────► │  TanStack server │ ────────────────► │  Supabase  │
│  (Cloudflare   │                  │  fn enqueues a   │                   │  DB +      │
│   Worker)      │                  │  render_jobs row │                   │  Storage   │
└────────────────┘                  └──────────────────┘                   └─────┬──────┘
                                                                                  │
                                                                                  │ polls / NOTIFY
                                                                                  ▼
                                                           ┌────────────────────────────────┐
                                                           │  Render worker  (DigitalOcean) │
                                                           │  ┌──────────────────────────┐  │
                                                           │  │ Express HTTP server      │  │
                                                           │  │  POST /jobs/:id/start    │  │
                                                           │  │  POST /jobs/:id/cancel   │  │
                                                           │  └──────────────────────────┘  │
                                                           │  ┌──────────────────────────┐  │
                                                           │  │ Remotion bundle + render │  │
                                                           │  │  - headless Chromium     │  │
                                                           │  │  - frame-accurate H.264  │  │
                                                           │  │  - <Audio> + voice tracks│  │
                                                           │  └──────────────────────────┘  │
                                                           │  ┌──────────────────────────┐  │
                                                           │  │ Upload MP4 → Supabase    │  │
                                                           │  │ Storage, mark job done   │  │
                                                           │  └──────────────────────────┘  │
                                                           └────────────────────────────────┘
```

**Data flow:**
1. User clicks "Export" in the app.
2. App calls a server function `enqueueRenderJob(projectId, settings)` which
   inserts a row in `render_jobs` (status `queued`).
3. Worker polls `render_jobs` for `queued` rows (or app pings worker via HTTP).
4. Worker fetches the project + scenes + scene_elements from Supabase using the
   service role key, bundles the Remotion composition, renders to MP4.
5. Worker uploads the MP4 to the `animation-cache` bucket and updates the job row
   with the public URL and `status = done`.
6. App polls the job row (or subscribes via Realtime) and shows the download link.

---

## 2. Provision the droplet

Recommended: **Ubuntu 24.04 LTS, CPU-Optimized 4 vCPU / 8 GB RAM**
($48–$84/mo). 1080p30 renders are CPU-bound; more vCPUs ≈ proportionally faster.

### 2.1 Create the droplet

```bash
# From your laptop — pick a region close to your Supabase region
doctl compute droplet create codemotion-renderer \
  --image ubuntu-24-04-x64 \
  --size c-4 \
  --region nyc1 \
  --ssh-keys <YOUR_SSH_KEY_ID>
```

Or use the DO web UI. SSH in:

```bash
ssh root@<droplet-ip>
```

### 2.2 Install system dependencies

```bash
apt-get update
apt-get install -y \
  curl git ca-certificates gnupg \
  ffmpeg \
  fonts-liberation fonts-noto-color-emoji fonts-noto-cjk \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 \
  libxdamage1 libxrandr2 libgbm1 libxkbcommon0 libpango-1.0-0 \
  libcairo2 libasound2t64 libxshmfence1
```

Install Node 20 LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v   # v20.x
```

Install Bun (we use it in the project, but npm works too):

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

Install Chromium for Remotion:

```bash
apt-get install -y chromium-browser
which chromium-browser   # /usr/bin/chromium-browser  → use this in REMOTION_CHROME_EXECUTABLE
```

### 2.3 Create a non-root user (recommended)

```bash
adduser --disabled-password --gecos "" renderer
usermod -aG sudo renderer
rsync --archive --chown=renderer:renderer ~/.ssh /home/renderer
su - renderer
```

---

## 3. Deploy the worker code

### 3.1 Pull the worker

The Lovable repo's `worker/` directory has the starter scaffold. On the droplet:

```bash
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/<your-org>/<your-repo>.git codemotion
cd codemotion/worker
bun install
```

If you don't want to ship the whole repo, copy only `worker/` over with `scp`
or `rsync`:

```bash
# From your laptop
rsync -av --exclude node_modules ./worker/ renderer@<droplet-ip>:~/apps/codemotion-worker/
```

### 3.2 Environment variables

Create `~/apps/codemotion/worker/.env`:

```bash
# Supabase
SUPABASE_URL=https://lejhqiimhkhlotcydzbt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key_from_supabase>

# Worker
PORT=8787
WORKER_SHARED_SECRET=<generate_a_random_64_char_string>   # openssl rand -hex 32
REMOTION_CHROME_EXECUTABLE=/usr/bin/chromium-browser

# Optional
RENDER_CONCURRENCY=2          # how many parallel renders
LOG_LEVEL=info
```

> **Where to find the service role key:** Lovable Cloud → backend → Project
> Settings → API. Treat it like a database password — it bypasses RLS.

### 3.3 Open the firewall

```bash
ufw allow OpenSSH
ufw allow 8787/tcp     # only if app calls worker directly
ufw enable
```

If you want HTTPS (recommended), put **Caddy** in front and skip the open port:

```bash
apt-get install -y caddy
cat >/etc/caddy/Caddyfile <<'EOF'
renderer.yourdomain.com {
  reverse_proxy 127.0.0.1:8787
}
EOF
systemctl reload caddy
```

DNS-A-record `renderer.yourdomain.com` → droplet IP. Caddy auto-provisions Let's Encrypt.

---

## 4. Worker code

The shape below replaces / extends what's already in `worker/`. Key files:

```
worker/
├── package.json
├── tsconfig.json
├── src/
│   ├── server.ts          # Express HTTP API (start/cancel/status)
│   ├── render.ts          # Remotion bundle + render + upload
│   ├── queue.ts           # Polls render_jobs from Supabase
│   └── supabase.ts        # Service-role client + job helpers
└── remotion/
    ├── index.ts           # registerRoot
    ├── Root.tsx           # Composition registration
    ├── MainVideo.tsx      # Scene compositor
    ├── SceneRenderer.tsx  # Single scene
    └── elements/
        ├── TextElement.tsx
        ├── LottieElement.tsx
        ├── VideoElement.tsx
        ├── ImageElement.tsx
        └── ShapeElement.tsx
```

### 4.1 `worker/package.json`

```json
{
  "name": "codemotion-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "node --enable-source-maps dist/server.js",
    "build": "tsc -p ."
  },
  "dependencies": {
    "@remotion/bundler": "^4.0.0",
    "@remotion/cli": "^4.0.0",
    "@remotion/lottie": "^4.0.0",
    "@remotion/renderer": "^4.0.0",
    "@supabase/supabase-js": "^2.45.0",
    "express": "^4.21.0",
    "remotion": "^4.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/express": "^4",
    "@types/node": "^20",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

### 4.2 `worker/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src", "remotion"]
}
```

### 4.3 `worker/src/supabase.ts`

```ts
import { createClient } from "@supabase/supabase-js";

export const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export async function fetchJobBundle(jobId: string) {
  const { data: job, error } = await sb
    .from("render_jobs")
    .select("id, project_id, scene_ids, settings, status")
    .eq("id", jobId)
    .single();
  if (error || !job) throw new Error(`job ${jobId} not found`);

  const sceneFilter = job.scene_ids?.length
    ? sb.from("scenes").select("*").in("id", job.scene_ids)
    : sb.from("scenes").select("*").eq("project_id", job.project_id);

  const { data: scenes } = await sceneFilter.order("order_index");
  const sceneIds = (scenes ?? []).map((s) => s.id);
  const { data: elements } = await sb
    .from("scene_elements")
    .select("*")
    .in("scene_id", sceneIds)
    .order("z_index");

  const elementsByScene = new Map<string, any[]>();
  for (const id of sceneIds) elementsByScene.set(id, []);
  for (const e of elements ?? []) elementsByScene.get(e.scene_id)?.push(e);

  return {
    job,
    scenes: (scenes ?? []).map((s) => ({
      ...s,
      elements: elementsByScene.get(s.id) ?? [],
    })),
  };
}

export async function updateJob(
  jobId: string,
  patch: Partial<{
    status: "queued" | "rendering" | "done" | "failed" | "cancelled";
    progress: number;
    output_url: string;
    error: string;
  }>,
) {
  await sb.from("render_jobs").update(patch).eq("id", jobId);
}
```

### 4.4 `worker/src/render.ts`

```ts
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { sb, fetchJobBundle, updateJob } from "./supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RES = {
  "720p":     { width: 1280, height: 720,  fps: 30 },
  "1080p":    { width: 1920, height: 1080, fps: 30 },
  "1080p60":  { width: 1920, height: 1080, fps: 60 },
  "4k":       { width: 3840, height: 2160, fps: 30 },
} as const;

let bundledOnce: string | null = null;

export async function runRender(jobId: string) {
  await updateJob(jobId, { status: "rendering", progress: 1 });

  const { job, scenes } = await fetchJobBundle(jobId);
  const settings = job.settings ?? {};
  const res = RES[(settings.resolution as keyof typeof RES) ?? "1080p"];
  const totalMs = scenes.reduce((s, sc) => s + (sc.duration_ms ?? 4000), 0) || 4000;
  const durationInFrames = Math.max(res.fps, Math.round((totalMs / 1000) * res.fps));

  // Bundle once and reuse — re-bundling per render is the #1 perf mistake.
  if (!bundledOnce) {
    bundledOnce = await bundle({
      entryPoint: path.resolve(__dirname, "../remotion/index.ts"),
      webpackOverride: (c) => c,
    });
  }

  const inputProps = {
    scenes,
    fps: res.fps,
    width: res.width,
    height: res.height,
    includeAudio: settings.includeAudio !== false,
  };

  const composition = await selectComposition({
    serveUrl: bundledOnce,
    id: "main",
    inputProps,
  });

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "render-"));
  const outPath = path.join(outDir, `${jobId}.mp4`);

  await renderMedia({
    composition: {
      ...composition,
      width: res.width,
      height: res.height,
      fps: res.fps,
      durationInFrames,
    },
    serveUrl: bundledOnce,
    codec: "h264",
    crf: settings.quality === "high" ? 16 : 20,
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    enforceAudioTrack: true,
    outputLocation: outPath,
    inputProps,
    chromiumOptions: {
      headless: true,
      gl: "swangle",   // software WebGL — works on droplets without GPU
    },
    browserExecutable: process.env.REMOTION_CHROME_EXECUTABLE,
    concurrency: Number(process.env.RENDER_CONCURRENCY ?? 2),
    onProgress: ({ progress }) => {
      const pct = Math.min(95, Math.round(progress * 90) + 5);
      void updateJob(jobId, { progress: pct });
    },
  });

  // Upload to Supabase Storage
  const bytes = await fs.readFile(outPath);
  const storagePath = `renders/${jobId}.mp4`;
  const { error: upErr } = await sb.storage
    .from("animation-cache")
    .upload(storagePath, bytes, { contentType: "video/mp4", upsert: true });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  const { data: pub } = sb.storage.from("animation-cache").getPublicUrl(storagePath);

  await updateJob(jobId, { status: "done", progress: 100, output_url: pub.publicUrl });
  await fs.rm(outDir, { recursive: true, force: true });
}
```

### 4.5 `worker/src/server.ts`

```ts
import "dotenv/config";
import express from "express";
import { runRender } from "./render.js";
import { startQueueLoop } from "./queue.js";
import { updateJob } from "./supabase.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const SHARED_SECRET = process.env.WORKER_SHARED_SECRET!;

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const got = req.headers.authorization?.replace(/^Bearer /, "");
  if (got !== SHARED_SECRET) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// On-demand trigger — app calls this immediately after enqueuing a job
// so we don't have to wait for the next poll tick.
app.post("/jobs/:id/start", auth, async (req, res) => {
  const id = req.params.id;
  res.json({ accepted: true });
  runRender(id).catch(async (err) => {
    console.error("render failed", id, err);
    await updateJob(id, { status: "failed", error: String(err?.message ?? err) });
  });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`worker listening on :${port}`);
  startQueueLoop().catch((err) => console.error("queue loop crashed", err));
});
```

### 4.6 `worker/src/queue.ts`

```ts
import { sb } from "./supabase.js";
import { runRender } from "./render.js";
import { updateJob } from "./supabase.js";

const POLL_INTERVAL_MS = 5_000;
const inflight = new Set<string>();
const MAX_PARALLEL = Number(process.env.RENDER_CONCURRENCY ?? 1);

export async function startQueueLoop() {
  // Reset any "rendering" jobs that were owned by a previous (now-dead) instance.
  // Optional: only safe if you run a single worker. With multiple workers,
  // use a `worker_id` + heartbeat column instead.
  await sb.from("render_jobs")
    .update({ status: "queued", progress: 0 })
    .eq("status", "rendering");

  setInterval(tick, POLL_INTERVAL_MS);
}

async function tick() {
  if (inflight.size >= MAX_PARALLEL) return;
  const need = MAX_PARALLEL - inflight.size;

  const { data: jobs } = await sb
    .from("render_jobs")
    .select("id")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(need);

  for (const j of jobs ?? []) {
    if (inflight.has(j.id)) continue;
    inflight.add(j.id);
    runRender(j.id)
      .catch(async (err) => {
        console.error("render failed", j.id, err);
        await updateJob(j.id, { status: "failed", error: String(err?.message ?? err) });
      })
      .finally(() => inflight.delete(j.id));
  }
}
```

### 4.7 `worker/remotion/index.ts`

```ts
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";
registerRoot(RemotionRoot);
```

### 4.8 `worker/remotion/Root.tsx`

```tsx
import { Composition } from "remotion";
import { MainVideo } from "./MainVideo";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="main"
      component={MainVideo}
      // These get overridden by `selectComposition` per render.
      durationInFrames={300}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        scenes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        includeAudio: true,
      }}
      calculateMetadata={({ props }) => {
        const totalMs = (props.scenes ?? []).reduce(
          (s: number, sc: any) => s + (sc.duration_ms ?? 4000),
          0,
        ) || 4000;
        const fps = props.fps ?? 30;
        return {
          durationInFrames: Math.max(fps, Math.round((totalMs / 1000) * fps)),
          fps,
          width: props.width ?? 1920,
          height: props.height ?? 1080,
        };
      }}
    />
  </>
);
```

### 4.9 `worker/remotion/MainVideo.tsx`

```tsx
import { AbsoluteFill, Series, Audio, useVideoConfig } from "remotion";
import { SceneRenderer } from "./SceneRenderer";

export const MainVideo: React.FC<{
  scenes: any[];
  includeAudio: boolean;
}> = ({ scenes, includeAudio }) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: "#ffffff" }}>
      <Series>
        {scenes.map((scene) => {
          const frames = Math.max(1, Math.round(((scene.duration_ms ?? 4000) / 1000) * fps));
          return (
            <Series.Sequence key={scene.id} durationInFrames={frames}>
              <SceneRenderer scene={scene} />
              {includeAudio && scene.voice_url && (
                <Audio
                  src={scene.voice_url}
                  startFrom={Math.round(((scene.voice_start_ms ?? 0) / 1000) * fps)}
                  endAt={
                    scene.voice_end_ms
                      ? Math.round((scene.voice_end_ms / 1000) * fps)
                      : undefined
                  }
                  volume={scene.voice_volume ?? 1}
                />
              )}
            </Series.Sequence>
          );
        })}
      </Series>
    </AbsoluteFill>
  );
};
```

### 4.10 `worker/remotion/SceneRenderer.tsx`

```tsx
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
} from "remotion";
import { TextElement } from "./elements/TextElement";
import { LottieElement } from "./elements/LottieElement";
import { VideoElement } from "./elements/VideoElement";
import { ImageElement } from "./elements/ImageElement";
import { ShapeElement } from "./elements/ShapeElement";

const TEXT_REVEAL_FRAMES = 5;   // ~150ms @30fps
const BLOCK_REVEAL_FRAMES = 11; // ~350ms @30fps

function normalizeWord(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function audibleOffsetMs(scene: any, wordStartMs: number): number | null {
  const trimStart = Math.max(0, scene.voice_trim_start_ms ?? 0);
  const trimEnd = scene.voice_trim_end_ms ?? scene.duration_ms ?? Infinity;
  if (wordStartMs < trimStart || wordStartMs > trimEnd) return null;
  const cuts = (scene.voice_cuts ?? []).filter(
    (c: any) => c.end_ms > trimStart && c.start_ms < trimEnd,
  );
  if (cuts.some((c: any) => wordStartMs >= c.start_ms && wordStartMs <= c.end_ms)) return null;
  let elapsed = 0;
  let cursor = trimStart;
  for (const cut of [...cuts].sort((a: any, b: any) => a.start_ms - b.start_ms)) {
    const a = Math.max(cut.start_ms, trimStart);
    const b = Math.min(cut.end_ms, trimEnd);
    if (wordStartMs < a) return elapsed + Math.max(0, wordStartMs - cursor);
    elapsed += Math.max(0, a - cursor);
    cursor = Math.max(cursor, b);
  }
  return elapsed + Math.max(0, wordStartMs - cursor);
}

function elementRevealMs(scene: any, el: any): number {
  const timings = scene.word_timings ?? [];
  const swi = el.content?.start_word_index;
  const word = el.content?.word ? normalizeWord(el.content.word) : "";
  if (!word && (typeof swi !== "number" || !timings[swi])) return 0;
  if (typeof swi === "number" && timings[swi]) {
    return audibleOffsetMs(scene, timings[swi].start_ms) ?? timings[swi].start_ms;
  }
  if (word) {
    const occ = Math.max(1, el.content.occurrence ?? 1);
    let seen = 0;
    for (const t of timings) {
      if (normalizeWord(t.text) !== word) continue;
      if (++seen === occ) return audibleOffsetMs(scene, t.start_ms) ?? t.start_ms;
    }
    return Math.max(0, (scene.duration_ms ?? 0) - 800);
  }
  return 0;
}

export const SceneRenderer: React.FC<{ scene: any }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bgColor = scene.background?.type === "color" ? scene.background.value : "#ffffff";

  const sortedEls = [...(scene.elements ?? [])].sort((a, b) => a.z_index - b.z_index);

  return (
    <AbsoluteFill style={{ background: bgColor }}>
      {sortedEls.map((el) => {
        const isText =
          el.type === "text" || typeof el.content?.text === "string" || !!el.content?.role;
        const revealMs = elementRevealMs(scene, el);
        const revealFrame = Math.round((revealMs / 1000) * fps);
        const dur = isText ? TEXT_REVEAL_FRAMES : BLOCK_REVEAL_FRAMES;
        const opacity = interpolate(frame, [revealFrame, revealFrame + dur], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        });
        const scale = isText
          ? 1
          : interpolate(frame, [revealFrame, revealFrame + dur], [0.92, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            });
        if (frame < revealFrame) return null;

        const style: React.CSSProperties = {
          position: "absolute",
          left: el.position.x,
          top: el.position.y,
          width: el.position.w,
          height: el.position.h,
          zIndex: el.z_index,
          opacity,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        };

        const sinceMs = ((frame - revealFrame) / fps) * 1000;

        if (isText) return <TextElement key={el.id} el={el} style={style} />;
        if (el.type === "animation" && el.content?.lottie_url)
          return <LottieElement key={el.id} el={el} style={style} sinceMs={sinceMs} />;
        if (el.content?.video_url)
          return <VideoElement key={el.id} el={el} style={style} sinceMs={sinceMs} />;
        if (el.content?.image_url || el.content?.lottie_url)
          return <ImageElement key={el.id} el={el} style={style} />;
        if (el.content?.shape_type) return <ShapeElement key={el.id} el={el} style={style} />;
        return null;
      })}
    </AbsoluteFill>
  );
};
```

### 4.11 Element components — sketch

```tsx
// elements/TextElement.tsx
export const TextElement: React.FC<{ el: any; style: React.CSSProperties }> = ({ el, style }) => (
  <div
    style={{
      ...style,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: el.content?.color ?? "#0f172a",
      fontFamily: el.content?.font_family ?? "Inter, system-ui, sans-serif",
      fontSize: el.content?.font_size ?? 32,
      fontWeight: el.content?.font_weight ?? 400,
      textAlign: "center",
      whiteSpace: "pre-wrap",
    }}
  >
    {el.content?.text ?? ""}
  </div>
);
```

```tsx
// elements/LottieElement.tsx
import { Lottie } from "@remotion/lottie";
import { useEffect, useState } from "react";

export const LottieElement: React.FC<{
  el: any; style: React.CSSProperties; sinceMs: number;
}> = ({ el, style }) => {
  const [json, setJson] = useState<any | null>(null);
  useEffect(() => {
    fetch(el.content.lottie_url).then((r) => r.json()).then(setJson).catch(() => {});
  }, [el.content.lottie_url]);
  if (!json) return <div style={style} />;
  return (
    <div style={style}>
      <Lottie
        animationData={json}
        loop={el.content.loop ?? true}
        playbackRate={el.content.speed ?? 1}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
};
```

```tsx
// elements/VideoElement.tsx
import { OffthreadVideo, Sequence } from "remotion";

export const VideoElement: React.FC<{ el: any; style: React.CSSProperties }> = ({ el, style }) => (
  <div style={style}>
    <OffthreadVideo
      src={el.content.video_url}
      muted
      style={{ width: "100%", height: "100%", objectFit: "contain" }}
    />
  </div>
);
```

```tsx
// elements/ImageElement.tsx
import { Img } from "remotion";

export const ImageElement: React.FC<{ el: any; style: React.CSSProperties }> = ({ el, style }) => {
  const src = el.content.image_url || el.content.video_url || el.content.lottie_url;
  if (!src) return null;
  return (
    <div style={style}>
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </div>
  );
};
```

`ShapeElement.tsx`: copy `ShapeGlyph` from `src/components/AnimationBlock.tsx`
verbatim — it's pure SVG and works inside Remotion unchanged.

> **Why `<OffthreadVideo>` instead of plain `<video>`:** Remotion runs ffmpeg
> off the main thread to extract the exact decoded frame for every composition
> frame. A real `<video>` tag inside the headless browser would seek async and
> capture wrong frames during a fast render.

> **Why `<Lottie>` (from `@remotion/lottie`) instead of `dotlottie-react`:**
> the official package is `useCurrentFrame()`-aware and seeks the playhead
> deterministically per frame. `dotlottie-react` plays in real time and would
> reproduce the same problem we're escaping from.

---

## 5. Run it under systemd

Create `/etc/systemd/system/codemotion-worker.service`:

```ini
[Unit]
Description=CodeMotion render worker
After=network.target

[Service]
User=renderer
WorkingDirectory=/home/renderer/apps/codemotion/worker
EnvironmentFile=/home/renderer/apps/codemotion/worker/.env
ExecStart=/usr/bin/node --enable-source-maps dist/server.js
Restart=on-failure
RestartSec=5
LimitNOFILE=8192

[Install]
WantedBy=multi-user.target
```

Build + enable:

```bash
cd ~/apps/codemotion/worker
bun install
bun run build           # emits dist/

sudo systemctl daemon-reload
sudo systemctl enable --now codemotion-worker
sudo systemctl status codemotion-worker
journalctl -u codemotion-worker -f
```

Smoke test:

```bash
curl https://renderer.yourdomain.com/healthz
# {"ok":true,"ts":1731620000000}
```

---

## 6. Wire the Lovable app to the worker

### 6.1 Add a secret in Lovable Cloud

Add `WORKER_URL` (e.g. `https://renderer.yourdomain.com`) and
`WORKER_SHARED_SECRET` (the same string from `worker/.env`) via Lovable's
**Add Secret** flow.

### 6.2 Update `src/server/render-jobs.functions.ts`

After inserting the row, ping the worker so rendering starts immediately
instead of waiting for the next poll tick:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const enqueueRenderJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      projectId: z.string().uuid(),
      sceneIds: z.array(z.string().uuid()).optional(),
      settings: z.object({
        resolution: z.enum(["720p", "1080p", "1080p60", "4k"]).default("1080p"),
        includeAudio: z.boolean().default(true),
        quality: z.enum(["standard", "high"]).default("standard"),
      }),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await supabaseAdmin
      .from("render_jobs")
      .insert({
        project_id: data.projectId,
        scene_ids: data.sceneIds ?? null,
        settings: data.settings,
        status: "queued",
        progress: 0,
        user_id: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Best-effort kick — fall back to the worker's polling loop on failure.
    void fetch(`${process.env.WORKER_URL}/jobs/${row.id}/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.WORKER_SHARED_SECRET}` },
    }).catch(() => {});

    return { jobId: row.id };
  });
```

### 6.3 Replace the export page's body

In `src/routes/projects.$projectId.export.tsx` remove the in-browser exporter
plumbing and instead:

1. Call `enqueueRenderJob` with the picked scenes and settings.
2. Subscribe to that row via `supabase.channel()` Realtime (or `setInterval`
   `select progress, status, output_url where id = ...`).
3. Show a progress bar from `progress`. When `status = done`, render a download
   button pointing at `output_url`. When `status = failed`, show the error.

This is a clean replacement for the messy `MediaRecorder` / WebCodecs code path.
Keep the deterministic browser exporter as a *fallback* if the worker URL is
not configured — handy for local dev.

---

## 7. Operations

### Logs

```bash
journalctl -u codemotion-worker -f --since "10 minutes ago"
```

### Restart after a deploy

```bash
cd ~/apps/codemotion/worker
git pull
bun install
bun run build
sudo systemctl restart codemotion-worker
```

### Scale up

- **Vertical:** resize droplet to more vCPUs. Bump `RENDER_CONCURRENCY`.
- **Horizontal:** spin up N droplets, point them all at the same Supabase. Add a
  `worker_id` and `started_at` column to `render_jobs` and use a `SELECT … FOR
  UPDATE SKIP LOCKED`-style claim instead of the simple `eq("status",
  "queued")` filter, so two workers never grab the same job.

### Costs (DigitalOcean, ballpark)

| Plan | Monthly | 1080p30 render speed |
| --- | --- | --- |
| 2 vCPU / 4 GB | $24 | ~0.5–0.7× realtime |
| 4 vCPU / 8 GB CPU-Optimized | $84 | ~1.5–2× realtime |
| 8 vCPU / 16 GB CPU-Optimized | $168 | ~3–4× realtime |

A 30-second 1080p30 video on the 4-vCPU plan finishes in ~15 s.

---

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Failed to launch the browser process` | `apt-get install chromium-browser` and set `REMOTION_CHROME_EXECUTABLE=/usr/bin/chromium-browser` |
| `libnss3.so: cannot open shared object file` | Re-run the apt-get install in §2.2 — you missed the headless deps |
| Renders are 100 % CPU but slow | Bump droplet size (CPU-Optimized) and increase `concurrency` in `renderMedia` |
| Lottie blank / not animating | Confirm `@remotion/lottie` is installed and `lottie_url` returns valid JSON (CORS-enabled) |
| Voice missing in MP4 | `voice_url` must be publicly readable. Check Supabase bucket is public OR sign URLs server-side before passing to `<Audio>` |
| Fonts wrong | Install the font package or load via `@remotion/google-fonts/<Name>` at module scope inside the Remotion bundle |
| `403` from worker | App and worker `WORKER_SHARED_SECRET` don't match |
| Worker sees no jobs | Service role key wrong or RLS on `render_jobs` blocks server-role writes (it shouldn't, service role bypasses RLS) |

---

## 9. What changed in the Lovable app today

To complement this server move, the in-browser export was also tightened so it
matches preview exactly **for as long as you keep the browser exporter as a
fallback**:

- `ExportSceneStage` now derives opacity/scale from virtual `currentMs`
  instead of CSS transitions (CSS transitions animate on wall-clock time and
  were causing the "all at once" symptom and the white start).
- Element reveal logic now mirrors `PlaybackDialog`: anything without a
  bound `content.word` reveals at scene start, exactly like preview.
- `AnimationBlockRenderer` accepts `currentMs` and uses it to seek Lottie
  playheads (`dotLottie.setFrame(...)`) and `<video>.currentTime` — fixing the
  "Lottie/video appear frozen on first frame" problem in the browser export.

These browser-side fixes are the right safety net, but the server worker
described here is the production path.
