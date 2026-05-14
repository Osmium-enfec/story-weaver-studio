import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sb } from "./supabase.js";

/**
 * Re-encode a video stored in Supabase Storage to a Remotion-friendly
 * baseline: H.264 (yuv420p) + AAC, +faststart.
 *
 * The bundled Remotion compositor's ffmpeg can't decode HEVC, AV1, ProRes,
 * VP9 in many containers, etc. Normalising every input to H.264 yuv420p
 * eliminates "Decoder not found" failures.
 *
 * Idempotent: if the file is already H.264 yuv420p AAC mp4, we skip
 * unless `force: true`.
 */
export async function transcodeStorageVideo(opts: {
  bucket: string;
  path: string;
  force?: boolean;
}): Promise<{
  ok: true;
  bucket: string;
  path: string;
  publicUrl: string;
  skipped: boolean;
  inputCodec?: string;
  inputPixFmt?: string;
}> {
  const { bucket, path: objectPath, force } = opts;

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "transcode-"));
  const inPath = path.join(tmp, "in" + path.extname(objectPath || "in.mp4"));
  const outPath = path.join(tmp, "out.mp4");

  try {
    // 1. Download from Supabase Storage (service role, bypasses RLS).
    const { data: blob, error: dlErr } = await sb.storage
      .from(bucket)
      .download(objectPath);
    if (dlErr || !blob) {
      throw new Error(`download ${bucket}/${objectPath}: ${dlErr?.message}`);
    }
    const buf = Buffer.from(await blob.arrayBuffer());
    await fs.writeFile(inPath, buf);

    // 2. Probe codec.
    const probe = await ffprobe(inPath);
    const v = probe.streams?.find((s) => s.codec_type === "video");
    const a = probe.streams?.find((s) => s.codec_type === "audio");
    const inputCodec = v?.codec_name;
    const inputPixFmt = v?.pix_fmt;
    const isH264 = inputCodec === "h264";
    const isYuv420p = inputPixFmt === "yuv420p";
    const isAac = !a || a.codec_name === "aac";
    const isMp4 = (probe.format?.format_name ?? "").includes("mp4");
    const alreadyGood = isH264 && isYuv420p && isAac && isMp4;

    if (alreadyGood && !force) {
      const { data: pub } = sb.storage.from(bucket).getPublicUrl(objectPath);
      return {
        ok: true,
        bucket,
        path: objectPath,
        publicUrl: pub.publicUrl,
        skipped: true,
        inputCodec,
        inputPixFmt,
      };
    }

    // 3. Transcode → H.264 yuv420p + AAC + faststart, even dimensions.
    await ffmpeg([
      "-y",
      "-i", inPath,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      outPath,
    ]);

    const outBuf = await fs.readFile(outPath);

    // 4. Upload back to the same path (upsert).
    const { error: upErr } = await sb.storage
      .from(bucket)
      .upload(objectPath, outBuf, {
        contentType: "video/mp4",
        upsert: true,
      });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    const { data: pub } = sb.storage.from(bucket).getPublicUrl(objectPath);
    return {
      ok: true,
      bucket,
      path: objectPath,
      publicUrl: pub.publicUrl,
      skipped: false,
      inputCodec,
      inputPixFmt,
    };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

interface ProbeResult {
  format?: { format_name?: string; duration?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    pix_fmt?: string;
  }>;
}

function ffprobe(file: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const bin = process.env.REMOTION_FFPROBE_EXECUTABLE ?? "ffprobe";
    const p = spawn(bin, [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      file,
    ]);
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exit ${code}: ${err}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = process.env.REMOTION_FFMPEG_EXECUTABLE ?? "ffmpeg";
    const p = spawn(bin, args);
    let err = "";
    p.stderr.on("data", (c) => (err += c));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}: ${err.slice(-2000)}`));
      resolve();
    });
  });
}
