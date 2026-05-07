import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

interface WordTiming {
  text: string;
  start_ms: number;
  end_ms: number;
}

function getAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Transcribes a voice file already uploaded to storage and splits it into
 * scenes. Replaces existing scenes for the project.
 */
export const transcribeAndSplit = createServerFn({ method: "POST" })
  .inputValidator((d: { projectId: string; voiceUrl: string; storagePath: string; targetSceneCount?: number }) =>
    z
      .object({
        projectId: z.string().uuid(),
        voiceUrl: z.string().url(),
        storagePath: z.string().min(1),
        targetSceneCount: z.number().int().min(1).max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const admin = getAdmin();

    // Download the audio from storage as a Blob
    const { data: blob, error: dlErr } = await admin.storage
      .from("voice-uploads")
      .download(data.storagePath);
    if (dlErr || !blob) throw new Error(`Failed to download audio: ${dlErr?.message ?? "unknown"}`);

    // Call OpenAI Whisper with word-level timestamps
    const form = new FormData();
    const filename = data.storagePath.split("/").pop() ?? "audio.mp3";
    form.append("file", blob, filename);
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Whisper API failed [${res.status}]: ${txt}`);
    }
    const tr = (await res.json()) as {
      text: string;
      duration?: number;
      words?: { word: string; start: number; end: number }[];
      segments?: { id: number; text: string; start: number; end: number }[];
    };

    const wordsAll: WordTiming[] = (tr.words ?? []).map((w) => ({
      text: w.word.trim(),
      start_ms: Math.round(w.start * 1000),
      end_ms: Math.round(w.end * 1000),
    }));
    const totalMs = Math.round(((tr.duration ?? 0) || (wordsAll.at(-1)?.end_ms ?? 0) / 1000) * 1000) ||
      (wordsAll.at(-1)?.end_ms ?? 0);

    // Split into scenes by sentences, then greedy-pack to target ~6-10s
    const segments = tr.segments ?? [];
    const sentences: { text: string; start_ms: number; end_ms: number; words: WordTiming[] }[] = [];

    if (segments.length > 0) {
      // Use Whisper's segments as base sentences
      for (const seg of segments) {
        const start = Math.round(seg.start * 1000);
        const end = Math.round(seg.end * 1000);
        const segWords = wordsAll.filter((w) => w.start_ms >= start - 50 && w.end_ms <= end + 50);
        sentences.push({ text: seg.text.trim(), start_ms: start, end_ms: end, words: segWords });
      }
    } else {
      // Fallback: split fulltext into sentences and approximate timings
      const text = tr.text;
      const re = /[^.!?]+[.!?]+|\S+$/g;
      let pos = 0;
      const matches = text.match(re) ?? [text];
      const perCharMs = totalMs / Math.max(1, text.length);
      for (const m of matches) {
        const idx = text.indexOf(m, pos);
        const start_ms = Math.round(idx * perCharMs);
        const end_ms = Math.round((idx + m.length) * perCharMs);
        const segWords = wordsAll.filter((w) => w.start_ms >= start_ms - 50 && w.end_ms <= end_ms + 50);
        sentences.push({ text: m.trim(), start_ms, end_ms, words: segWords });
        pos = idx + m.length;
      }
    }

    // Greedy pack into scenes
    const target = data.targetSceneCount;
    const TARGET_MS = target ? Math.max(2000, Math.floor(totalMs / target)) : 8000;
    const MIN_MS = 4000;
    const MAX_MS = 12000;

    const scenes: { text: string; start_ms: number; end_ms: number; words: WordTiming[] }[] = [];
    let cur: typeof scenes[0] | null = null;
    for (const s of sentences) {
      if (!cur) {
        cur = { text: s.text, start_ms: s.start_ms, end_ms: s.end_ms, words: [...s.words] };
        continue;
      }
      const dur = cur.end_ms - cur.start_ms;
      const newDur = s.end_ms - cur.start_ms;
      if (dur < MIN_MS || (newDur <= MAX_MS && newDur <= TARGET_MS)) {
        cur.text += " " + s.text;
        cur.end_ms = s.end_ms;
        cur.words.push(...s.words);
      } else {
        scenes.push(cur);
        cur = { text: s.text, start_ms: s.start_ms, end_ms: s.end_ms, words: [...s.words] };
      }
    }
    if (cur) scenes.push(cur);

    // If user gave target count and we overshot, merge shortest neighbors
    if (target && scenes.length > target) {
      while (scenes.length > target) {
        let minI = 0;
        let minDur = Infinity;
        for (let i = 0; i < scenes.length; i++) {
          const d = scenes[i].end_ms - scenes[i].start_ms;
          if (d < minDur) {
            minDur = d;
            minI = i;
          }
        }
        const mergeWith = minI === scenes.length - 1 ? minI - 1 : minI + 1;
        const a = Math.min(minI, mergeWith);
        const b = Math.max(minI, mergeWith);
        scenes[a] = {
          text: scenes[a].text + " " + scenes[b].text,
          start_ms: Math.min(scenes[a].start_ms, scenes[b].start_ms),
          end_ms: Math.max(scenes[a].end_ms, scenes[b].end_ms),
          words: [...scenes[a].words, ...scenes[b].words].sort((x, y) => x.start_ms - y.start_ms),
        };
        scenes.splice(b, 1);
      }
    }

    // Wipe old scenes for this project
    const { data: oldScenes } = await admin
      .from("scenes")
      .select("id")
      .eq("project_id", data.projectId);
    if (oldScenes && oldScenes.length > 0) {
      const ids = oldScenes.map((s: { id: string }) => s.id);
      await admin.from("scene_elements").delete().in("scene_id", ids);
      await admin.from("scenes").delete().in("id", ids);
    }

    // Insert new scenes
    const rows = scenes.map((s, i) => ({
      project_id: data.projectId,
      order_index: i,
      narration: s.text,
      visual_brief: "",
      detected_concepts: [],
      duration_ms: Math.max(1000, s.end_ms - s.start_ms),
      voice_url: data.voiceUrl,
      voice_start_ms: s.start_ms,
      voice_end_ms: s.end_ms,
      // word_timings stored relative to the scene start so playback can use scene-local times
      word_timings: s.words.map((w) => ({
        text: w.text,
        start_ms: w.start_ms - s.start_ms,
        end_ms: w.end_ms - s.start_ms,
      })),
    }));

    const { data: insertedScenes, error: insErr } = await admin
      .from("scenes")
      .insert(rows)
      .select("id, order_index");
    if (insErr) throw new Error(`Failed to insert scenes: ${insErr.message}`);

    // Auto-seed 3-5 keyword-bound animations per scene (best-effort, swallow failures)
    try {
      await seedSceneAnimations(admin, insertedScenes ?? [], scenes);
    } catch (e) {
      console.error("seedSceneAnimations failed", e);
    }

    // Save the master voice track
    await admin.from("voice_tracks").insert({
      project_id: data.projectId,
      url: data.voiceUrl,
      transcript: tr.text,
      duration_ms: totalMs,
      source: "uploaded",
      word_timestamps: wordsAll as unknown as never,
    });

    // Update project script
    await admin
      .from("projects")
      .update({ script: tr.text, estimated_duration_ms: totalMs })
      .eq("id", data.projectId);

    return {
      sceneCount: rows.length,
      transcript: tr.text,
      durationMs: totalMs,
    };
  });

/**
 * Re-transcribe a single audio clip (already uploaded) and update one scene's
 * narration / word_timings / voice_url. Used when a user re-records or
 * re-uploads audio for a specific canvas, or trims/cuts and wants timings
 * resynced.
 */
export const transcribeClip = createServerFn({ method: "POST" })
  .inputValidator((d: { sceneId: string; voiceUrl: string; storagePath: string; durationMs?: number }) =>
    z
      .object({
        sceneId: z.string().uuid(),
        voiceUrl: z.string().url(),
        storagePath: z.string().min(1),
        durationMs: z.number().int().positive().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const admin = getAdmin();
    const { data: blob, error: dlErr } = await admin.storage
      .from("voice-uploads")
      .download(data.storagePath);
    if (dlErr || !blob) throw new Error(`Failed to download audio: ${dlErr?.message ?? "unknown"}`);

    const form = new FormData();
    const filename = data.storagePath.split("/").pop() ?? "clip.webm";
    form.append("file", blob, filename);
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Whisper API failed [${res.status}]: ${txt}`);
    }
    const tr = (await res.json()) as {
      text: string;
      duration?: number;
      words?: { word: string; start: number; end: number }[];
    };

    const words: WordTiming[] = (tr.words ?? []).map((w) => ({
      text: w.word.trim(),
      start_ms: Math.round(w.start * 1000),
      end_ms: Math.round(w.end * 1000),
    }));
    const totalMs =
      data.durationMs ??
      Math.round((tr.duration ?? 0) * 1000) ??
      (words.at(-1)?.end_ms ?? 0);

    const { error: upErr } = await admin
      .from("scenes")
      .update({
        voice_url: data.voiceUrl,
        voice_start_ms: 0,
        voice_end_ms: totalMs,
        voice_trim_start_ms: 0,
        voice_trim_end_ms: null,
        voice_cuts: [] as unknown as never,
        word_timings: words as unknown as never,
        narration: tr.text,
        duration_ms: Math.max(1000, totalMs),
      })
      .eq("id", data.sceneId);
    if (upErr) throw new Error(`Failed to update scene: ${upErr.message}`);

    return { transcript: tr.text, durationMs: totalMs, wordCount: words.length };
  });
