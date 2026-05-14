/**
 * Backfill: re-encode every existing video in Supabase Storage to
 * H.264 yuv420p + AAC mp4 so Remotion's bundled compositor can decode it.
 *
 * Scans:
 *   - animation_components.video_url   (Iconscout MP4 mirrors, etc.)
 *   - media_assets.url WHERE type = 'video'
 *
 * Buckets we know about: animation-cache, lottie-uploads, scene-backgrounds.
 * URLs outside Supabase storage (or in unknown buckets) are skipped.
 *
 * Run on the droplet:
 *   cd ~/apps/codemotion/worker
 *   node --import tsx scripts/transcode-existing.ts
 *
 * Idempotent — files already H.264 yuv420p AAC mp4 are skipped.
 * Re-run anytime; pass --force to re-encode everything.
 */
import { sb } from "../src/supabase.js";
import { transcodeStorageVideo } from "../src/transcode.js";

const FORCE = process.argv.includes("--force");
const KNOWN_BUCKETS = new Set([
  "animation-cache",
  "lottie-uploads",
  "scene-backgrounds",
]);

interface Target {
  bucket: string;
  path: string;
  source: string;
}

function parseStorageUrl(url: string): { bucket: string; path: string } | null {
  if (!url) return null;
  // Public URL shape: <SUPABASE_URL>/storage/v1/object/public/<bucket>/<path>
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (!m) return null;
  const bucket = decodeURIComponent(m[1]);
  const path = decodeURIComponent(m[2]);
  if (!KNOWN_BUCKETS.has(bucket)) return null;
  return { bucket, path };
}

function looksLikeVideo(p: string) {
  return /\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(p);
}

async function collectTargets(): Promise<Target[]> {
  const targets = new Map<string, Target>();
  const add = (bucket: string, path: string, source: string) => {
    const k = `${bucket}|${path}`;
    if (!targets.has(k)) targets.set(k, { bucket, path, source });
  };

  // 1. animation_components.video_url
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await sb
      .from("animation_components")
      .select("id, video_url")
      .not("video_url", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const parsed = parseStorageUrl(row.video_url);
      if (parsed && looksLikeVideo(parsed.path)) {
        add(parsed.bucket, parsed.path, `animation_components:${row.id}`);
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // 2. media_assets.url where type = 'video'
  from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("media_assets")
      .select("id, url, type")
      .eq("type", "video")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const parsed = parseStorageUrl(row.url);
      if (parsed && looksLikeVideo(parsed.path)) {
        add(parsed.bucket, parsed.path, `media_assets:${row.id}`);
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return [...targets.values()];
}

async function main() {
  console.log(`scanning… (force=${FORCE})`);
  const targets = await collectTargets();
  console.log(`found ${targets.length} candidate videos in storage`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const tag = `[${i + 1}/${targets.length}] ${t.bucket}/${t.path}`;
    try {
      const r = await transcodeStorageVideo({
        bucket: t.bucket,
        path: t.path,
        force: FORCE,
      });
      if (r.skipped) {
        skipped++;
        console.log(`${tag}  SKIP (already h264/yuv420p/aac mp4)`);
      } else {
        ok++;
        console.log(`${tag}  OK  (was ${r.inputCodec ?? "?"} ${r.inputPixFmt ?? "?"})`);
      }
    } catch (err) {
      failed++;
      console.error(`${tag}  FAIL ${(err as Error)?.message ?? err}`);
    }
  }

  console.log(`\ndone. transcoded=${ok} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => {
  console.error("backfill crashed", err);
  process.exit(1);
});
