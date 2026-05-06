# Code Motion Render Worker

Renders Remotion videos for the Lovable app and uploads MP4s to Lovable Cloud Storage.

## Deploy to Fly.io

### 1. Install flyctl
```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

### 2. Launch (first time only — from inside the `worker/` folder)
```bash
cd worker
fly launch --no-deploy --copy-config --name code-motion-render-worker --region iad
```
- When asked to overwrite `fly.toml`, say **No** (we already have one).
- When asked to set up Postgres / Redis, say **No**.

If the name `code-motion-render-worker` is taken, run with a different `--name` and update the `app =` line in `fly.toml`.

### 3. Set secrets
Generate a random secret:
```bash
openssl rand -hex 32
```
Save the output. Then:
```bash
fly secrets set \
  RENDER_WORKER_SECRET=<paste-the-random-string> \
  LOVABLE_APP_URL=https://project--adee30b3-ab01-48b5-858a-891d7104de3b.lovable.app \
  SUPABASE_URL=<your supabase url> \
  SUPABASE_SERVICE_ROLE_KEY=<your service role key>
```

You can find `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your Lovable project under **Cloud → Secrets** (they're already configured there).

### 4. Deploy
```bash
fly deploy
```

First deploy takes ~5 minutes (Chromium + ffmpeg image is large).

### 5. Grab your URL
```bash
fly status
```
Your `Hostname` is the URL — e.g. `code-motion-render-worker.fly.dev`. The full URL you give Lovable is `https://code-motion-render-worker.fly.dev`.

### 6. Plug back into Lovable
In the Lovable chat, give me:
- `RENDER_WORKER_URL` = `https://code-motion-render-worker.fly.dev`
- `RENDER_WORKER_SECRET` = the random string from step 3

I'll add them as secrets and the Export page will start firing real renders.

## Test locally (optional)
```bash
npm install
RENDER_WORKER_SECRET=dev LOVABLE_APP_URL=https://project--adee30b3-ab01-48b5-858a-891d7104de3b.lovable.app SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run dev
curl http://localhost:8080
```

## Notes
- The Fly machine `auto_stop_machines = "stop"` — it sleeps when idle, wakes on the first `/render` call (cold start ~10s).
- Renders run in the background; the HTTP request returns immediately. Progress is posted back to your app every few seconds.
- MP4s are uploaded to the `animation-cache` bucket as `renders/<jobId>.mp4` and the public URL is stored on the render job.
