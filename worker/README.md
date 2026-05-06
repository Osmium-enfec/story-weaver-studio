# Code Motion Render Worker — Deploy on Render.com

Renders Remotion videos for the Lovable app and uploads MP4s to Lovable Cloud Storage.

## Deploy on Render.com (no CLI needed)

### 1. Push this `worker/` folder to a GitHub repo
Render deploys from GitHub. Easiest path:
1. Create a new GitHub repo (e.g. `code-motion-render-worker`) — can be private.
2. Copy the contents of this `worker/` folder into the repo root and push.

> If you'd rather keep everything in one repo, you can also point Render at a subdirectory — see step 3.

### 2. Sign in to Render
Go to https://render.com and sign up / log in (free, GitHub login works).

### 3. Create the service
1. Click **New +** → **Web Service**.
2. Connect your GitHub account and pick the repo from step 1.
3. Render will auto-detect the `render.yaml` and `Dockerfile`. Confirm:
   - **Runtime**: Docker
   - **Plan**: Standard ($25/mo — needed for Chromium + ffmpeg headroom)
   - **Region**: pick the closest one
   - **Branch**: `main`
   - If you put the worker in a subfolder of a bigger repo, set **Root Directory** to `worker`.
4. Click **Create Web Service**. The first build takes ~5–8 min (Chromium + ffmpeg image is ~1.5 GB).

### 4. Set the environment variables
In the service dashboard → **Environment** → **Add Environment Variable**, add all four:

| Key | Value |
|-----|-------|
| `RENDER_WORKER_SECRET` | Run `openssl rand -hex 32` locally and paste the output. **Save this — you'll give it to Lovable.** |
| `LOVABLE_APP_URL` | `https://project--adee30b3-ab01-48b5-858a-891d7104de3b.lovable.app` |
| `SUPABASE_URL` | (from your Lovable Cloud secrets) |
| `SUPABASE_SERVICE_ROLE_KEY` | (from your Lovable Cloud secrets) |

Click **Save Changes** — Render will redeploy automatically.

### 5. Grab your URL
Top of the service page: e.g. `https://code-motion-render-worker.onrender.com`. That's your `RENDER_WORKER_URL`.

### 6. Plug back into Lovable
In the Lovable chat, paste:
- `RENDER_WORKER_URL` = `https://code-motion-render-worker.onrender.com`
- `RENDER_WORKER_SECRET` = the random string from step 4

I'll add them as secrets and the Export page will start firing real renders.

---

## Notes about the Render.com free/standard tier
- The **Standard** plan ($25/mo) keeps the service warm 24/7 — no cold starts.
- The **Free** plan sleeps after 15 min of inactivity AND has only 512 MB RAM — **not enough** for Remotion + Chromium. Don't use free.
- If 4K renders crash with OOM, bump the plan to **Pro** (4 GB RAM) in the dashboard.

## Test locally (optional)
```bash
cd worker
npm install
RENDER_WORKER_SECRET=dev \
LOVABLE_APP_URL=https://project--adee30b3-ab01-48b5-858a-891d7104de3b.lovable.app \
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run dev
curl http://localhost:8080
```
