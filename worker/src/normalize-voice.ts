import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sb } from "./supabase.js";

/**
 * Remotion's bundled ffmpeg has no Opus decoder, so .webm voice tracks
 * (MediaRecorder default in browsers) crash the compositor with
 * "Decoder not found" the moment a frame in that scene is sampled.
 *
 * Before each render we walk the scene list, transcode any non-mp3/aac
 * voice file to mp3 in the same bucket, and persist the new url back to
 * `scenes.voice_url` so subsequent jobs don't repeat the work.
 *
 * Returns the scenes array with `voice_url` rewritten in place.
 */

const SAFE_EXT = /\.(mp3|m4a|aac|wav)(\?|$)/i;

export async function normalizeSceneVoices<T extends { id: string; voice_url?: string | null }>(
  scenes: T[],
): Promise<T[]> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const publicPrefix = `${supabaseUrl}/storage/v1/object/public/`;

  for (const scene of scenes) {
    const url = scene.voice_url;
    if (!url || SAFE_EXT.test(url)) continue;
    if (!url.startsWith(publicPrefix)) continue; // unknown host, skip

    const rel = decodeURIComponent(url.slice(publicPrefix.length));
    const slash = rel.indexOf("/");
    if (slash <= 0) continue;
    const bucket = rel.slice(0, slash);
    const srcPath = rel.slice(slash + 1);
    const dstPath = srcPath.replace(/\.[a-z0-9]+$/i, "") + ".mp3";

    try {
      const newUrl = await transcodeToMp3(bucket, srcPath, dstPath, publicPrefix);
      scene.voice_url = newUrl;
      await sb.from("scenes").update({ voice_url: newUrl }).eq("id", scene.id);
      console.log(`[normalize-voice] ${scene.id} → ${dstPath}`);
    } catch (e) {
      console.error(`[normalize-voice] ${scene.id} failed:`, (e as Error).message);
    }
  }

  return scenes;
}

async function transcodeToMp3(
  bucket: string,
  srcPath: string,
  dstPath: string,
  publicPrefix: string,
): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "voice-"));
  const inFile = path.join(tmp, "in" + (path.extname(srcPath) || ".webm"));
  const outFile = path.join(tmp, "out.mp3");

  try {
    const { data: blob, error: dlErr } = await sb.storage.from(bucket).download(srcPath);
    if (dlErr || !blob) throw new Error(`download: ${dlErr?.message}`);
    await fs.writeFile(inFile, Buffer.from(await blob.arrayBuffer()));

    await ffmpeg([
      "-y", "-loglevel", "error",
      "-i", inFile,
      "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100",
      outFile,
    ]);

    const buf = await fs.readFile(outFile);
    const { error: upErr } = await sb.storage.from(bucket).upload(dstPath, buf, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    return publicPrefix + bucket + "/" + dstPath.split("/").map(encodeURIComponent).join("/");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = process.env.REMOTION_FFMPEG_EXECUTABLE ?? "ffmpeg";
    const p = spawn(bin, args);
    let err = "";
    p.stderr.on("data", (c) => (err += c));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}: ${err.slice(-1000)}`));
      resolve();
    });
  });
}
