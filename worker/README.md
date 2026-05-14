# CodeMotion Render Worker

Production render worker for CodeMotion. Frame-accurate Remotion
rendering on headless Chromium, exporting up to **4K H.264 / AAC**.

## What it renders

- Frame-accurate text reveals (per-word, voice-trim aware)
- Lottie animations via `@remotion/lottie` (deterministic playhead)
- Video clips via `<OffthreadVideo>` (exact frame extraction)
- Images, shapes, gradients, image backgrounds
- Voiceover audio per scene, trimmed to match

## Endpoints

- `GET  /healthz` – liveness probe
- `POST /render`  – kick a render. Body: `{ "jobId": "<uuid>" }`.
  Header: `x-worker-secret: <RENDER_WORKER_SECRET>`.

If the kick fails, the polling loop (`queue.ts`) will pick the job up within
~5 s as long as it is `status = 'pending'` in the `render_jobs` table.

## Settings the app can pass per job

```jsonc
// render_jobs.settings
{
  "resolution": "4k",       // "720p" | "1080p" | "1080p60" | "4k" | "4k60"
  "quality":    "max",      // "max" (CRF 12) | "high" (CRF 16) | "standard" (CRF 20)
  "includeAudio": true
}
```

Defaults: `4k`, `max`, audio on.

## Environment

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
RENDER_WORKER_SECRET=<openssl rand -hex 32>
PORT=8080
RENDER_CONCURRENCY=2
REMOTION_CHROME_EXECUTABLE=/usr/bin/chromium
QUEUE_POLL_MS=5000
```

## Deploy

See `docs/SERVER_RENDER_WORKER.md` in the main repo for the full DigitalOcean
droplet + systemd + Caddy walkthrough. TL;DR:

```bash
# On the droplet
git clone <repo> && cd <repo>/worker
npm install --legacy-peer-deps
# copy .env (see above)
node --import tsx/esm src/server.ts
# or use the provided Dockerfile / render.yaml
```

## File layout

```
worker/
├── Dockerfile
├── package.json
├── render.yaml                # render.com one-click config (optional)
├── tsconfig.json
├── remotion/
│   ├── index.ts               # registerRoot
│   ├── Root.tsx               # Composition + calculateMetadata
│   ├── MainVideo.tsx          # Series of scenes + per-scene <Audio>
│   ├── SceneRenderer.tsx      # frame-accurate reveal logic
│   └── elements/
│       ├── TextElement.tsx
│       ├── LottieElement.tsx
│       ├── VideoElement.tsx
│       ├── ImageElement.tsx
│       └── ShapeElement.tsx
└── src/
    ├── server.ts              # Express HTTP API
    ├── render.ts              # bundle + render + upload (cached bundle)
    ├── queue.ts               # polling fallback + concurrency guard
    └── supabase.ts            # service-role client + job helpers
```
