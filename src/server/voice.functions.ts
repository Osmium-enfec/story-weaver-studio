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

// ---------------- keyword auto-seeding ----------------

const STOPWORDS = new Set<string>([
  "a","an","the","and","or","but","if","then","so","because","as","while","of","at","by","for",
  "with","about","against","between","into","through","during","before","after","above","below",
  "to","from","up","down","in","out","on","off","over","under","again","further","once","here",
  "there","when","where","why","how","all","any","both","each","few","more","most","other","some",
  "such","no","nor","not","only","own","same","than","too","very","can","will","just","should",
  "now","is","am","are","was","were","be","been","being","have","has","had","having","do","does",
  "did","doing","i","me","my","myself","we","our","ours","ourselves","you","your","yours","he",
  "him","his","himself","she","her","hers","herself","it","its","itself","they","them","their",
  "theirs","themselves","what","which","who","whom","this","that","these","those","would","could",
  "shall","may","might","must","let","lets","like","also","really","actually","get","got","go",
  "going","make","made","one","two","first","second","next","ok","okay","yeah","yes","no",
]);

function pickKeywords(
  words: { text: string; start_ms: number; end_ms: number }[],
  max = 5,
  min = 3,
): { text: string; start_ms: number; end_ms: number; occurrence: number }[] {
  const seen = new Map<string, number>(); // lowercased -> count picked
  const out: { text: string; start_ms: number; end_ms: number; occurrence: number }[] = [];
  // First pass: prefer longer/distinct nouny words
  const candidates = words
    .map((w) => ({ ...w, clean: w.text.replace(/[^a-zA-Z0-9'-]/g, "").toLowerCase() }))
    .filter((w) => w.clean.length >= 4 && !STOPWORDS.has(w.clean));
  // Distribute roughly evenly across the scene
  const step = Math.max(1, Math.floor(candidates.length / max));
  for (let i = 0; i < candidates.length && out.length < max; i += step) {
    const c = candidates[i];
    const used = seen.get(c.clean) ?? 0;
    seen.set(c.clean, used + 1);
    out.push({ text: c.text, start_ms: c.start_ms, end_ms: c.end_ms, occurrence: used + 1 });
  }
  // Top up to min if needed using anything unused
  if (out.length < min) {
    for (const c of candidates) {
      if (out.length >= min) break;
      if (out.find((o) => o.start_ms === c.start_ms)) continue;
      const used = seen.get(c.clean) ?? 0;
      seen.set(c.clean, used + 1);
      out.push({ text: c.text, start_ms: c.start_ms, end_ms: c.end_ms, occurrence: used + 1 });
    }
  }
  return out;
}

async function iconscoutSearchOne(query: string): Promise<{
  external_id: string;
  uuid: string;
  name: string;
  slug: string;
  preview_url: string;
} | null> {
  const id = process.env.ICONSCOUT_CLIENT_ID;
  const secret = process.env.ICONSCOUT_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const url = new URL("https://api.iconscout.com/v3/search");
    url.searchParams.set("query", query);
    url.searchParams.set("product_type", "item");
    url.searchParams.set("asset", "lottie");
    url.searchParams.set("per_page", "5");
    const res = await fetch(url.toString(), {
      headers: { "Client-ID": id, "Client-Secret": secret },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const items = (json?.response?.items?.data ?? []) as any[];
    const free = items.find((it) => (it.price ?? 0) === 0) ?? items[0];
    if (!free) return null;
    return {
      external_id: String(free.id),
      uuid: free.uuid,
      name: free.name,
      slug: free.slug,
      preview_url: free.urls?.thumb ?? free.urls?.png ?? "",
    };
  } catch {
    return null;
  }
}

async function mirrorOne(
  admin: ReturnType<typeof getAdmin>,
  it: { external_id: string; uuid: string; name: string; slug: string; preview_url: string },
): Promise<{ video_url: string | null; lottie_url: string | null } | null> {
  if (!it.preview_url) return null;
  const { data: existing } = await admin
    .from("animation_components")
    .select("video_url, lottie_url")
    .eq("provider", "iconscout")
    .eq("external_id", it.external_id)
    .maybeSingle();
  if (existing) return { video_url: existing.video_url, lottie_url: existing.lottie_url };

  const ext = it.preview_url.includes(".json") ? "json" : "mp4";
  const ct = ext === "json" ? "application/json" : "video/mp4";
  const path = `iconscout/${it.external_id}.${ext}`;
  try {
    const res = await fetch(it.preview_url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const up = await admin.storage.from("animation-cache").upload(path, buf, { contentType: ct, upsert: true });
    if (up.error) return null;
    const { data: pub } = admin.storage.from("animation-cache").getPublicUrl(path);
    const row = {
      slug: it.slug || `iconscout-${it.external_id}`,
      name: it.name,
      category: "Iconscout",
      provider: "iconscout",
      external_id: it.external_id,
      video_url: ext === "mp4" ? pub.publicUrl : null,
      lottie_url: ext === "json" ? pub.publicUrl : null,
      thumbnail_url: pub.publicUrl,
      color_support: "fixed",
    };
    await admin.from("animation_components").insert(row);
    return { video_url: row.video_url, lottie_url: row.lottie_url };
  } catch {
    return null;
  }
}

async function seedSceneAnimations(
  admin: ReturnType<typeof getAdmin>,
  insertedScenes: { id: string; order_index: number }[],
  builtScenes: { text: string; start_ms: number; end_ms: number; words: WordTiming[] }[],
) {
  // Sort so order_index aligns with builtScenes order
  const byOrder = [...insertedScenes].sort((a, b) => a.order_index - b.order_index);
  const elementRows: any[] = [];

  // Canvas reference size used in the editor
  const CW = 1280;
  const CH = 720;

  for (let i = 0; i < byOrder.length; i++) {
    const sceneId = byOrder[i].id;
    const built = builtScenes[i];
    if (!built) continue;
    // Word timings are stored relative to scene start in the DB. The picker uses local words too.
    const localWords = built.words.map((w) => ({
      text: w.text,
      start_ms: w.start_ms - built.start_ms,
      end_ms: w.end_ms - built.start_ms,
    }));
    const keywords = pickKeywords(localWords, 5, 3);
    let z = 0;
    for (const kw of keywords) {
      const found = await iconscoutSearchOne(kw.text);
      if (!found) continue;
      const mirrored = await mirrorOne(admin, found);
      if (!mirrored) continue;
      const w = Math.round(CW * 0.28);
      const h = Math.round(CH * 0.28);
      const x = Math.round((CW - w) / 2);
      const y = Math.round((CH - h) / 2);
      elementRows.push({
        scene_id: sceneId,
        type: "iconscout",
        content: {
          provider: "iconscout",
          name: found.name,
          slug: found.slug,
          lottie_url: mirrored.lottie_url,
          video_url: mirrored.video_url,
          external_id: found.external_id,
          loop: true,
          autoplay: true,
          speed: 1,
          opacity: 1,
          rotation: 0,
          color_support: "fixed",
          tint: null,
          remove_background: true,
          word: kw.text,
          occurrence: kw.occurrence,
        },
        position: { x, y, w, h },
        z_index: z++,
      });
    }
  }

  if (elementRows.length > 0) {
    await admin.from("scene_elements").insert(elementRows);
  }
}
