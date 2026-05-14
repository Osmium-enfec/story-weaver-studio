#!/usr/bin/env node
/**
 * One-shot fix: re-encode every .webm voice track to .mp3 so Remotion's
 * bundled ffmpeg (no Opus decoder) can sample the audio without throwing
 * "Decoder not found".
 *
 * Run on the worker host (ffmpeg in PATH):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node worker/scripts/transcode-webm-voices.mjs
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const exec = promisify(execFile);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws },
});

const BUCKET = "voice-uploads";
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

function urlToStoragePath(url) {
  if (!url.startsWith(PUBLIC_PREFIX)) return null;
  return decodeURIComponent(url.slice(PUBLIC_PREFIX.length));
}

async function processOne(scene) {
  const srcPath = urlToStoragePath(scene.voice_url);
  if (!srcPath) {
    console.warn(`skip ${scene.id}: not a public bucket url`);
    return;
  }
  const dstPath = srcPath.replace(/\.webm$/i, ".mp3");
  console.log(`→ ${scene.id}  ${srcPath}`);

  const dir = await mkdtemp(path.join(tmpdir(), "voice-"));
  const inFile = path.join(dir, "in.webm");
  const outFile = path.join(dir, "out.mp3");

  try {
    const res = await fetch(scene.voice_url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    await writeFile(inFile, Buffer.from(await res.arrayBuffer()));

    await exec("ffmpeg", [
      "-y", "-loglevel", "error",
      "-i", inFile,
      "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100",
      outFile,
    ]);

    const mp3 = await readFile(outFile);
    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(dstPath, mp3, {
        contentType: "audio/mpeg",
        upsert: true,
      });
    if (upErr) throw upErr;

    const newUrl = PUBLIC_PREFIX + dstPath.split("/").map(encodeURIComponent).join("/");
    const { error: updErr } = await sb
      .from("scenes")
      .update({ voice_url: newUrl })
      .eq("id", scene.id);
    if (updErr) throw updErr;

    console.log(`  ok → ${newUrl}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const { data: scenes, error } = await sb
  .from("scenes")
  .select("id, voice_url")
  .like("voice_url", "%.webm");

if (error) { console.error(error); process.exit(1); }
console.log(`found ${scenes.length} webm voice tracks`);

let ok = 0, fail = 0;
for (const s of scenes) {
  try { await processOne(s); ok++; }
  catch (e) { fail++; console.error(`  FAIL ${s.id}:`, e.message); }
}
console.log(`done. transcoded=${ok} failed=${fail}`);
