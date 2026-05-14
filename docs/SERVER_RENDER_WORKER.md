# Server-Side Render Worker (DigitalOcean)

Production-grade render worker for CodeMotion. Frame-accurate Remotion
rendering on headless Chromium, exporting up to **4K H.264 / AAC**.

> **Status:** All worker source lives in `worker/` in this repo and is ready
> to deploy. This doc covers *why*, *how to provision*, *how to deploy*, and
> *how the Lovable app talks to it*. You should not need to copy/paste source
> from this doc — it's already in the repo.

---

## 1. Why a server worker?

Browser export problems we hit (and why each one is unfixable in the browser):

| Problem in browser export | Root cause | Why a server worker fixes it |
| --- | --- | --- |
| White/blank frames at the start | `html-to-image` snapshots take 50–200 ms; the encoder samples every 33 ms and grabs a stale canvas | Remotion blocks until React commits each frame, then asks the browser for a real screenshot at that exact frame |
| Animations all appear at once | CSS transitions are wall-clock based; virtual time advances faster than wall time | Every animation is `useCurrentFrame()`-driven — deterministic per frame |
| Lottie shows the wrong frame | `DotLottieReact` plays in real time; we capture whatever frame happens to be visible | `@remotion/lottie` exposes the playhead and is driven by `useCurrentFrame()` |
| Iconscout video clips look frozen | `<video>` plays in wall-clock time; `currentTime` not synced to capture | Remotion's `<OffthreadVideo>` extracts the exact decoded frame for each composition frame |
| MP4 conversion fragile (`ffmpeg.wasm`) | WASM ffmpeg breaks under various CSP / SAB / cross-origin setups | Native ffmpeg in the worker emits H.264 + AAC directly |
| Tab must stay open and active | Browsers throttle background tabs | Worker runs server-side; user closes the tab and gets a download link when done |
| Slow on weaker devices | Render speed = user device speed | Renders on a CPU you control; horizontally scalable |
| Capped at ~1080p | Browser canvas + recorder bandwidth limits | Native ffmpeg renders true 4K@30 (or 60) with no extra cost |

---

## 2. Architecture

```
┌────────────────┐  enqueueRenderJob  ┌──────────────────┐  insert row     ┌────────────┐
│  Lovable app   │ ─────────────────► │  TanStack server │ ──────────────► │  Supabase  │
│  (Cloudflare   │                    │  fn + best-effort│                 │  render_   │
│   Worker)      │                    │  HTTP kick       │                 │  jobs      │
└────────────────┘                    └────────┬─────────┘                 └─────┬──────┘
                                               │ POST /render                    │
                                               ▼                                 │
                                  ┌────────────────────────────────┐             │
                                  │  Render worker  (DigitalOcean) │             │
                                  │  ┌──────────────────────────┐  │             │
                                  │  │ Express HTTP /render     │  │             │
                                  │  │ + 5s polling fallback    │◄─┼─────────────┘
                                  │  └──────────────────────────┘  │
                                  │  ┌──────────────────────────┐  │
                                  │  │ Remotion bundle (cached) │  │
                                  │  │ + headless Chromium      │  │
                                  │  │ + frame-accurate render  │  │
                                  │  │ + native ffmpeg → MP4    │  │
                                  │  └──────────────────────────┘  │
                                  │  ┌──────────────────────────┐  │
                                  │  │ Upload MP4 → Supabase    │  │
                                  │  │ Storage, mark job done   │  │
                                  │  └──────────────────────────┘  │
                                  └────────────────────────────────┘
```

**Data flow**

1. User clicks Export. App calls `enqueueRenderJob(projectId, settings)`
   (`src/server/render-jobs.functions.ts`), which inserts a `render_jobs` row
   with `status = 'pending'`.
2. The same server fn does a best-effort `POST /render` to the worker so it
   starts immediately. If the worker is offline, the row stays `pending`.
3. Worker either receives the kick OR the polling loop (~5 s) sees `pending`
   rows and claims one (subject to `RENDER_CONCURRENCY`).
4. Worker fetches the project + scenes + scene_elements via the service-role
   key, renders with Remotion to MP4.
5. Worker uploads to the `animation-cache` Supabase Storage bucket and POSTs
   `{ status: 'done', output_url }` to `/api/public/render-jobs/update`.
6. App polls (or subscribes to) the job row and shows the download link.

---

## 3. Repo layout

Everything you need is committed:

```
worker/
├── Dockerfile               # Chromium + ffmpeg + fonts + node 20
├── README.md                # quickstart
├── package.json             # remotion, @remotion/lottie, supabase-js, express, zod
├── render.yaml              # render.com one-click config (optional)
├── tsconfig.json
├── remotion/
│   ├── index.ts             # registerRoot
│   ├── Root.tsx             # Composition + calculateMetadata (size/fps/duration per job)
│   ├── MainVideo.tsx        # <Series> of scenes + per-scene <Audio>
│   ├── SceneRenderer.tsx    # frame-accurate reveal logic (mirrors ExportSceneStage)
│   └── elements/
│       ├── TextElement.tsx
│       ├── LottieElement.tsx    # @remotion/lottie + delayRender until JSON loads
│       ├── VideoElement.tsx     # <OffthreadVideo>
│       ├── ImageElement.tsx
│       └── ShapeElement.tsx
└── src/
    ├── server.ts            # Express: GET /healthz, POST /render
    ├── render.ts            # bundle (cached) + render + upload
    ├── queue.ts             # polling fallback + concurrency guard
    └── supabase.ts          # service-role client + job helpers
```

In the Lovable app:

```
src/server/render-jobs.functions.ts            # enqueueRenderJob, listRenderJobs
src/routes/api.public.render-jobs.$jobId.ts    # worker fetches job + scenes
src/routes/api.public.render-jobs.update.ts    # worker posts status/progress/output
```

---

## 4. Provision the droplet

Recommended: **Ubuntu 24.04 LTS, CPU-Optimized 4 vCPU / 8 GB RAM**
(~$84/mo). Bigger droplets render proportionally faster.

For 4K renders bump to **8 vCPU / 16 GB CPU-Optimized** (~$168/mo) — 4K is
~4× the pixels of 1080p.

### 4.1 Create the droplet

```bash
doctl compute droplet create codemotion-renderer \
  --image ubuntu-24-04-x64 \
  --size c-4 \
  --region nyc1 \
  --ssh-keys <YOUR_SSH_KEY_ID>

ssh root@<droplet-ip>
```

### 4.2 Install system dependencies

```bash
apt-get update
apt-get install -y \
  curl git ca-certificates gnupg \
  ffmpeg \
  fonts-liberation fonts-noto-color-emoji fonts-noto-cjk fonts-inter \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxcomposite1 \
  libxdamage1 libxrandr2 libgbm1 libxkbcommon0 libpango-1.0-0 \
  libcairo2 libasound2t64 libxshmfence1

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Chromium for Remotion
apt-get install -y chromium-browser
which chromium-browser   # → /usr/bin/chromium-browser
```

### 4.3 Non-root user (recommended)

```bash
adduser --disabled-password --gecos "" renderer
usermod -aG sudo renderer
rsync --archive --chown=renderer:renderer ~/.ssh /home/renderer
su - renderer
```

---

## 5. Deploy the worker

### 5.1 Get the code on the droplet

```bash
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/<your-org>/<your-repo>.git codemotion
cd codemotion/worker
npm install --legacy-peer-deps
```

Or copy just `worker/` over with rsync:

```bash
# from your laptop
rsync -av --exclude node_modules ./worker/ renderer@<droplet-ip>:~/apps/codemotion-worker/
```

### 5.2 Environment variables

Create `~/apps/codemotion/worker/.env`:

```bash
# Supabase (service role bypasses RLS — keep secret)
SUPABASE_URL=https://lejhqiimhkhlotcydzbt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>

# Worker
PORT=8080
RENDER_WORKER_SECRET=<openssl rand -hex 32>
LOVABLE_APP_URL=https://codemotion.lovable.app   # used by status callbacks
REMOTION_CHROME_EXECUTABLE=/usr/bin/chromium-browser

# Tuning
RENDER_CONCURRENCY=2     # parallel renders allowed
QUEUE_POLL_MS=5000
```

> **Service role key** lives in Lovable Cloud → backend → Project Settings →
> API. It bypasses RLS — treat it like a database password.

### 5.3 Open the firewall

```bash
ufw allow OpenSSH
ufw allow 8080/tcp        # only if app calls worker directly on the IP
ufw enable
```

For HTTPS (recommended), put **Caddy** in front and skip the open port:

```bash
apt-get install -y caddy
cat >/etc/caddy/Caddyfile <<'EOF'
renderer.yourdomain.com {
  reverse_proxy 127.0.0.1:8080
}
EOF
systemctl reload caddy
```

DNS A-record `renderer.yourdomain.com` → droplet IP. Caddy auto-provisions
Let's Encrypt.

### 5.4 Run under systemd

`/etc/systemd/system/codemotion-worker.service`:

```ini
[Unit]
Description=CodeMotion render worker
After=network.target

[Service]
User=renderer
WorkingDirectory=/home/renderer/apps/codemotion/worker
EnvironmentFile=/home/renderer/apps/codemotion/worker/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
LimitNOFILE=8192

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now codemotion-worker
sudo systemctl status codemotion-worker
journalctl -u codemotion-worker -f
```

Smoke test:

```bash
curl https://renderer.yourdomain.com/healthz
# {"ok":true,"ts":...}
```

### 5.5 (Alternative) Docker

```bash
cd worker
docker build -t codemotion-worker .
docker run -d --name codemotion-worker --restart=always \
  --env-file .env -p 8080:8080 codemotion-worker
```

---

## 6. How the Lovable app talks to the worker

The wiring is already in the app. You just need to set two secrets:

| Secret | Where | Value |
| --- | --- | --- |
| `RENDER_WORKER_URL` | Lovable Cloud secret | `https://renderer.yourdomain.com` |
| `RENDER_WORKER_SECRET` | Lovable Cloud secret | same string as in `worker/.env` |

`enqueueRenderJob` (`src/server/render-jobs.functions.ts`) inserts the row
and pings `${RENDER_WORKER_URL}/render` with the shared secret. The worker
acks immediately and runs the render in the background.

The worker calls back to the app via two server routes:

- `GET  /api/public/render-jobs/:jobId`     — fetch job + scenes
- `POST /api/public/render-jobs/update`     — patch progress / status / output_url

Both routes verify `x-worker-secret: <RENDER_WORKER_SECRET>` before doing
anything.

---

## 7. Job settings (per render)

The app passes `settings` on the `render_jobs` row. The worker reads:

```jsonc
{
  // 720p | 1080p | 1080p60 | 4k | 4k60     (default: 4k)
  "resolution": "4k",

  // standard (CRF 20) | high (CRF 16) | max (CRF 12)  (default: max)
  "quality":    "max",

  // include voiceover audio per scene?  (default: true)
  "includeAudio": true
}
```

Defaults are tuned for **maximum quality**: 4K @ 30 fps, CRF 12 (visually
lossless), AAC 320 kbps.

---

## 8. Scaling and ops

### Logs

```bash
journalctl -u codemotion-worker -f --since "10 minutes ago"
```

### Restart after a deploy

```bash
cd ~/apps/codemotion
git pull
cd worker
npm install --legacy-peer-deps
sudo systemctl restart codemotion-worker
```

### Scale up

- **Vertical:** resize droplet → more vCPUs → bump `RENDER_CONCURRENCY`.
- **Horizontal:** spin up N droplets pointing at the same Supabase. The
  current `queue.ts` uses a simple `eq("status","pending")` claim — for
  multi-worker safety add a `worker_id` + `started_at` and switch to a
  `SELECT ... FOR UPDATE SKIP LOCKED` claim so two workers never grab the
  same job.

### Costs (DigitalOcean, ballpark)

| Plan | $/mo | 1080p30 speed | 4K30 speed |
| --- | --- | --- | --- |
| 2 vCPU / 4 GB | $24 | ~0.5–0.7× realtime | not recommended |
| 4 vCPU / 8 GB CPU-Opt | $84 | ~1.5–2× realtime | ~0.3–0.5× realtime |
| 8 vCPU / 16 GB CPU-Opt | $168 | ~3–4× realtime | ~0.8–1.2× realtime |

A 30 s 1080p30 video on the 4-vCPU plan finishes in ~15 s. The same video
in 4K @ max quality on the 8-vCPU plan finishes in ~30–40 s.

---

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Failed to launch the browser process` | `apt-get install chromium-browser` and set `REMOTION_CHROME_EXECUTABLE=/usr/bin/chromium-browser` |
| `libnss3.so: cannot open shared object file` | Re-run the apt-get install in §4.2 — you missed the headless deps |
| Renders are 100 % CPU but slow | Bigger droplet (CPU-Optimized) and/or increase `RENDER_CONCURRENCY` |
| Lottie blank / not animating | Confirm `lottie_url` returns valid JSON with permissive CORS. The worker's `LottieElement` uses `delayRender` until the fetch resolves — check worker logs for `lottie fetch failed` |
| Voice missing in MP4 | `voice_url` must be readable by the worker. The `voice-uploads` bucket is public in this project — if you change that, sign URLs server-side before passing to `<Audio>` |
| Wrong fonts | Add the font package on the droplet OR `loadFont` from `@remotion/google-fonts/<Name>` at module scope inside the Remotion bundle |
| `401 unauthorized` from worker | `RENDER_WORKER_SECRET` mismatch between Lovable and `worker/.env` |
| Worker sees no jobs | Service role key wrong, or job rows aren't `status='pending'`. Check Supabase directly |
| 4K render runs out of memory | Bump droplet RAM to ≥16 GB and lower `RENDER_CONCURRENCY` to 1 |
| Job stuck in `rendering` after a worker crash | The polling loop resets stale `rendering` rows to `pending` on boot. Just restart the worker |

---

## 10. Frame-accuracy notes

The browser exporter (kept as a fallback when no worker is configured) was
also tightened to match preview:

- `ExportSceneStage` derives opacity/scale from virtual `currentMs` instead
  of CSS transitions (CSS transitions are wall-clock based and caused the
  "all at once" / "white start" symptoms).
- Element reveal logic mirrors `PlaybackDialog`: anything without a bound
  `content.word` reveals at scene start.
- `AnimationBlockRenderer` accepts `currentMs` and uses it to seek Lottie
  playheads (`dotLottie.setFrame(...)`) and `<video>.currentTime`.

The worker's `SceneRenderer.tsx` uses the same reveal math, but driven by
`useCurrentFrame()` — guaranteeing identical timing without any wall-clock
race conditions. Per-frame Lottie seeking is handled by `@remotion/lottie`
and per-frame video decoding by `<OffthreadVideo>`. That's why the server
output is the production path.
