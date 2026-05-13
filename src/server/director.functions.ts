import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { ensure3DForKeywords, wants3D } from "./iconscout-3d.server";

/**
 * AI Director — turns a scene's narration + word-timings into a production
 * quality animation plan: asset choice, layout, entrance/exit, timing.
 *
 * Pipeline (per scene):
 *   1. Build candidate asset shortlist (library + iconscout previews)
 *   2. Ask GPT-5 to return a structured "scene_plan" via tool calling
 *   3. Compile plan into scene_elements rows (deterministic)
 *
 * Falls back gracefully if the LLM call fails.
 */

function getAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

const CANVAS_W = 1280;
const CANVAS_H = 720;

const THEME_TAGS: Record<string, string[]> = {
  Whiteboard: ["whiteboard", "sketch", "doodle", "hand-drawn"],
  "Dark Code": ["code", "developer", "terminal", "dark"],
  "Flat Modern": ["flat", "modern", "minimal"],
  "Android UI": ["android", "mobile", "app"],
  Classroom: ["education", "school", "learning"],
};

const STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","else","when","while","of","to","in","on","at",
  "for","from","by","with","about","as","is","are","was","were","be","been","being","have","has",
  "had","do","does","did","doing","i","me","my","you","your","he","she","it","they","them","this",
  "that","these","those","will","would","can","could","should","not","no","yes","so","very","just",
  "also","only","more","some","any","all","each","every","other","than","into","over","under","up",
  "down","out","off","again","once","here","there","what","which","who","how","why",
]);

interface CandidateAsset {
  id: string;
  name: string;
  slug: string;
  provider: string;
  preview_url: string | null;
  video_url: string | null;
  lottie_url: string | null;
  external_id: string | null;
  color_support: string;
  tags: string[];
  /** Optional: which storyboard beat this candidate was fetched for. */
  beat_id?: string;
  /** Optional: the keyword/query that surfaced this candidate. */
  source_query?: string;
}

/** Pick keyword tokens from narration to drive asset search. */
function extractKeywords(narration: string, max = 12): string[] {
  const tokens = (narration || "")
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  // Dedupe preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

async function findCandidates(
  admin: ReturnType<typeof getAdmin>,
  keywords: string[],
  themeTags: string[],
  perKeyword = 4,
  cap = 30,
): Promise<CandidateAsset[]> {
  const seen = new Map<string, CandidateAsset>();
  for (const kw of keywords) {
    const { data } = await admin
      .from("animation_components")
      .select("id, name, slug, provider, video_url, lottie_url, thumbnail_url, external_id, color_support, tags, category")
      .or(`name.ilike.%${kw}%,slug.ilike.%${kw}%,tags.cs.{${kw}},concepts.cs.{${kw}}`)
      .limit(perKeyword * 3);
    const rows = (data ?? []) as any[];
    // Prefer playable; then theme-matching
    const playable = rows.filter((r) => r.video_url || r.lottie_url);
    const pool = playable.length ? playable : rows;
    const themed = pool.filter((r) =>
      themeTags.some(
        (t) =>
          (r.tags ?? []).map((x: string) => String(x).toLowerCase()).includes(t) ||
          String(r.category ?? "").toLowerCase().includes(t),
      ),
    );
    const finalPool = (themed.length ? themed : pool).slice(0, perKeyword);
    for (const r of finalPool) {
      if (seen.has(r.id)) continue;
      seen.set(r.id, {
        id: r.id,
        name: r.name,
        slug: r.slug,
        provider: r.provider,
        preview_url: r.thumbnail_url ?? r.video_url ?? r.lottie_url,
        video_url: r.video_url,
        lottie_url: r.lottie_url,
        external_id: r.external_id,
        color_support: r.color_support ?? "fixed",
        tags: r.tags ?? [],
      });
      if (seen.size >= cap) break;
    }
    if (seen.size >= cap) break;
  }
  return Array.from(seen.values());
}

/** Synthesize approximate word timings from narration if the scene has none. */
function fakeTimings(narration: string, durationMs: number) {
  const tokens = (narration || "").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [] as { text: string; start_ms: number; end_ms: number }[];
  const total = durationMs && durationMs > 0 ? durationMs : tokens.length * 400;
  const per = total / tokens.length;
  return tokens.map((text, i) => ({
    text: text.replace(/[^\p{L}\p{N}'-]/gu, ""),
    start_ms: Math.round(i * per),
    end_ms: Math.round((i + 1) * per),
  }));
}

interface PlanElement {
  asset_id?: string | null;
  kind: "asset" | "text";
  text?: string;
  text_role?: "heading" | "subheading" | "caption";
  position: { x: number; y: number; w: number; h: number };
  anchor_word_index: number;
  duration_ms: number;
  enter?: {
    type: "fade" | "slide-up" | "slide-left" | "slide-right" | "scale" | "typewriter" | "word-reveal" | "bounce";
    duration_ms?: number;
    delay_ms?: number;
  } | null;
  exit?: { type: "fade" | "scale"; duration_ms?: number } | null;
}

interface ScenePlan {
  elements: PlanElement[];
  scene_transition_in?: "cut" | "fade" | "slide" | "zoom";
  rationale?: string;
}

const PLAN_TOOL = {
  type: "function" as const,
  function: {
    name: "render_scene",
    description:
      "Produce a production-quality scene plan: pick assets from the candidate list, place them with clean composition, and time their entrance against word_timings for a natural reveal.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["elements"],
      properties: {
        scene_transition_in: { type: "string", enum: ["cut", "fade", "slide", "zoom"] },
        rationale: { type: "string", description: "1-2 sentence summary of the creative direction." },
        elements: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "position", "anchor_word_index", "duration_ms"],
            properties: {
              kind: { type: "string", enum: ["asset", "text"] },
              asset_id: {
                type: "string",
                description: "UUID from the candidate_assets list. REQUIRED when kind=asset. Omit for kind=text.",
              },
              text: { type: "string", description: "Text content. REQUIRED when kind=text." },
              text_role: { type: "string", enum: ["heading", "subheading", "caption"] },
              position: {
                type: "object",
                additionalProperties: false,
                required: ["x", "y", "w", "h"],
                properties: {
                  x: { type: "number", minimum: 0, maximum: 1, description: "Normalised left (0..1)" },
                  y: { type: "number", minimum: 0, maximum: 1 },
                  w: { type: "number", minimum: 0.05, maximum: 1 },
                  h: { type: "number", minimum: 0.05, maximum: 1 },
                },
              },
              anchor_word_index: {
                type: "integer",
                minimum: 0,
                description: "Index into word_timings — element appears just before this word is spoken.",
              },
              duration_ms: { type: "integer", minimum: 400, description: "How long the element stays on screen." },
              enter: {
                type: "object",
                additionalProperties: false,
                required: ["type"],
                properties: {
                  type: { type: "string", enum: ["fade", "slide-up", "slide-left", "slide-right", "scale", "typewriter", "word-reveal", "bounce"] },
                  duration_ms: { type: "integer", minimum: 100, maximum: 2000 },
                  delay_ms: { type: "integer", minimum: 0, maximum: 2000 },
                },
              },
              exit: {
                type: "object",
                additionalProperties: false,
                required: ["type"],
                properties: {
                  type: { type: "string", enum: ["fade", "scale"] },
                  duration_ms: { type: "integer", minimum: 100, maximum: 2000 },
                },
              },
            },
          },
        },
      },
    },
  },
};

const DIRECTOR_SYSTEM = `You are a senior motion designer for an educational video editor.
You compose ONE scene at a time. Your job:
- Choose 2 to 5 elements that visually reinforce the narration.
- Prefer 1 "primary" focal element + supporting icons/text. Avoid 9-cell grid stacks.
- Place elements with intentional composition: a focal area (left/right/center), with supporting elements smaller and offset. Leave breathing room.
- Time each element's entrance to the moment its concept is spoken (anchor_word_index into the provided word_timings).
- Keep at most 3 elements visible at the same instant.
- Pick assets ONLY from the candidate_assets list (use the exact UUID in asset_id). If nothing fits, use a "text" element instead.
- Use text elements for key terms ("useState", "API", "Loop"), short callouts, or titles. Pair them with an asset where possible.
- Choose entrance animations that feel deliberate: fade for ambient, slide-up for arriving content, scale/bounce for emphasis, word-reveal for code/keywords, typewriter sparingly.
- Output via the render_scene tool. Do not write prose outside the tool call.`;

export interface StoryboardBeatHint {
  id?: string;
  label: string;
  kind: "title" | "icon" | "code" | "diagram" | "callout" | "image";
  asset_query?: string;
  anchor_word_index?: number;
  narration_excerpt?: string;
}

function buildUserPrompt(args: {
  theme: string;
  narration: string;
  word_timings: { text: string; start_ms: number; end_ms: number }[];
  duration_ms: number;
  candidates: CandidateAsset[];
  instruction?: string;
  storyboard?: StoryboardBeatHint[];
}) {
  const { theme, narration, word_timings, duration_ms, candidates, instruction, storyboard } = args;
  const wt = word_timings.slice(0, 60).map((w, i) => `${i}:${w.text}@${w.start_ms}`).join(" ");
  const cands = candidates
    .slice(0, 30)
    .map(
      (c) =>
        `- id=${c.id} name="${c.name}" provider=${c.provider} tags=[${c.tags.slice(0, 5).join(",")}]`,
    )
    .join("\n");
  const sb = storyboard && storyboard.length
    ? "\nAPPROVED STORYBOARD (use exactly this order, one element per beat):\n" +
      storyboard
        .map(
          (b, i) =>
            `${i + 1}. kind=${b.kind} label="${b.label}"${b.asset_query ? ` query="${b.asset_query}"` : ""}${
              typeof b.anchor_word_index === "number" ? ` anchor_word_index=${b.anchor_word_index}` : ""
            }`,
        )
        .join("\n") +
      "\nFor each beat: pick the closest candidate UUID for kind=icon/image/diagram by matching the query against name/tags; for kind=title/code/callout use a text element with the label. Keep anchor_word_index as given."
    : "";
  return [
    `Theme: ${theme}`,
    `Scene duration: ${duration_ms}ms`,
    `Narration: ${narration}`,
    `word_timings (idx:text@start_ms): ${wt}`,
    "",
    "candidate_assets (UUIDs you may reference):",
    cands || "(no library matches — use text elements)",
    sb,
    instruction ? `\nUSER INSTRUCTION: ${instruction}` : "",
  ].join("\n");
}

async function callDirectorLLM(
  prompt: string,
  apiKey: string,
): Promise<ScenePlan | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: DIRECTOR_SYSTEM },
          { role: "user", content: prompt },
        ],
        tools: [PLAN_TOOL],
        tool_choice: { type: "function", function: { name: "render_scene" } },
        temperature: 0.6,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error(`Director LLM ${res.status}:`, txt.slice(0, 500));
      return null;
    }
    const json = (await res.json()) as any;
    const call = json?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) return null;
    return JSON.parse(call.function.arguments) as ScenePlan;
  } catch (e) {
    console.error("Director LLM error:", e);
    return null;
  }
}

interface CompiledRow {
  scene_id: string;
  type: string;
  content: Record<string, unknown>;
  position: { x: number; y: number; w: number; h: number };
  z_index: number;
  start_ms: number;
  end_ms: number;
}

function compilePlan(
  sceneId: string,
  sceneDurationMs: number,
  wordTimings: { text: string; start_ms: number; end_ms: number }[],
  candidatesById: Map<string, CandidateAsset>,
  plan: ScenePlan,
): CompiledRow[] {
  const rows: CompiledRow[] = [];
  const els = plan.elements ?? [];
  els.forEach((el, idx) => {
    // Resolve timing from word index
    const wIdx = Math.max(0, Math.min(el.anchor_word_index ?? 0, Math.max(0, wordTimings.length - 1)));
    const startMs = wordTimings.length > 0
      ? Math.max(0, (wordTimings[wIdx]?.start_ms ?? 0) - 80)
      : Math.round(idx * 400);
    const endMs = Math.min(sceneDurationMs, startMs + Math.max(400, el.duration_ms ?? 2500));

    // Position in pixels (clamped within canvas)
    const px = Math.max(0, Math.min(1, el.position.x));
    const py = Math.max(0, Math.min(1, el.position.y));
    const pw = Math.max(0.05, Math.min(1 - px, el.position.w));
    const ph = Math.max(0.05, Math.min(1 - py, el.position.h));
    const position = {
      x: Math.round(px * CANVAS_W),
      y: Math.round(py * CANVAS_H),
      w: Math.round(pw * CANVAS_W),
      h: Math.round(ph * CANVAS_H),
    };

    if (el.kind === "text") {
      const role = el.text_role ?? "subheading";
      const sizeByRole: Record<string, number> = { heading: 72, subheading: 44, caption: 28 };
      const weightByRole: Record<string, number> = { heading: 700, subheading: 600, caption: 500 };
      rows.push({
        scene_id: sceneId,
        type: "text",
        position,
        z_index: idx,
        start_ms: startMs,
        end_ms: endMs,
        content: {
          provider: "internal",
          name: "Text",
          text: el.text ?? "",
          role,
          font_family: "Inter",
          font_size: sizeByRole[role] ?? 36,
          font_weight: weightByRole[role] ?? 600,
          line_height: 1.2,
          color: "#0f172a",
          text_animation: el.enter
            ? {
                type: el.enter.type,
                duration: el.enter.duration_ms ?? 600,
                delay: el.enter.delay_ms ?? 0,
                easing: "ease-out",
              }
            : { type: "fade", duration: 500, delay: 0, easing: "ease-out" },
        },
      });
      return;
    }

    // kind === "asset"
    const asset = el.asset_id ? candidatesById.get(el.asset_id) : null;
    if (!asset) return; // skip — LLM hallucinated id
    const type = asset.provider === "iconscout" ? "iconscout" : asset.provider === "lottie" ? "lottie" : "animation";
    rows.push({
      scene_id: sceneId,
      type,
      position,
      z_index: idx,
      start_ms: startMs,
      end_ms: endMs,
      content: {
        provider: asset.provider,
        name: asset.name,
        slug: asset.slug,
        lottie_url: asset.lottie_url,
        video_url: asset.video_url,
        external_id: asset.external_id,
        loop: true,
        autoplay: true,
        speed: 1,
        opacity: 1,
        rotation: 0,
        color_support: asset.color_support,
        tint: null,
        remove_background: asset.provider === "iconscout",
        text_animation: el.enter
          ? {
              type: el.enter.type,
              duration: el.enter.duration_ms ?? 500,
              delay: el.enter.delay_ms ?? 0,
              easing: "ease-out",
            }
          : null,
      },
    });
  });
  return rows;
}

export const directProject = createServerFn({ method: "POST" })
  .inputValidator((d: { projectId: string; sceneId?: string; replace?: boolean; instruction?: string; storyboardHint?: StoryboardBeatHint[] }) =>
    z
      .object({
        projectId: z.string().uuid(),
        sceneId: z.string().uuid().optional(),
        replace: z.boolean().optional(),
        instruction: z.string().max(500).optional(),
        storyboardHint: z.array(z.any()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    const admin = getAdmin();

    const { data: project } = await admin
      .from("projects")
      .select("theme")
      .eq("id", data.projectId)
      .single();
    const themeName = project?.theme ?? "Whiteboard";
    const themeTags = THEME_TAGS[themeName] ?? [];

    const sceneQuery = admin
      .from("scenes")
      .select("id, narration, duration_ms, word_timings")
      .eq("project_id", data.projectId)
      .order("order_index");
    const { data: scenes } = data.sceneId
      ? await sceneQuery.eq("id", data.sceneId)
      : await sceneQuery;
    const list = (scenes ?? []) as {
      id: string;
      narration: string | null;
      duration_ms: number | null;
      word_timings: { text: string; start_ms: number; end_ms: number }[] | null;
    }[];

    if (data.replace && list.length > 0) {
      await admin.from("scene_elements").delete().in("scene_id", list.map((s) => s.id));
    }

    let totalElements = 0;
    let scenesPlanned = 0;
    let scenesFallback = 0;

    // Run scenes in parallel batches of 3 to keep load + LLM rate manageable
    const BATCH = 3;
    for (let i = 0; i < list.length; i += BATCH) {
      const slice = list.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        slice.map(async (s) => {
          const narration = s.narration ?? "";
          const durationMs = s.duration_ms ?? 5000;
          const wt = s.word_timings && s.word_timings.length > 0
            ? s.word_timings
            : fakeTimings(narration, durationMs);

          const keywords = extractKeywords(narration, 12);
          const candidates = await findCandidates(admin, keywords, themeTags);

          // 3D icon intent: if instruction or any storyboard beat asks for 3D,
          // search Iconscout 3D per-beat (so each beat gets its OWN 3D candidates),
          // mirror, and add to the candidate pool with beat_id + source_query
          // stamped on each candidate so the LLM can match beat → asset and
          // anchor it to the beat's spoken word.
          const sbHint = data.storyboardHint as StoryboardBeatHint[] | undefined;
          const sbText = (sbHint ?? [])
            .map((b) => `${b.label} ${b.asset_query ?? ""}`)
            .join(" ");
          if (wants3D(data.instruction, sbText, narration)) {
            // Per-beat queries (preserves beat → asset linkage)
            const beatQueryPairs: { beatId: string; query: string }[] = (sbHint ?? [])
              .filter((b) => b.kind === "icon" || b.kind === "image" || b.kind === "diagram")
              .map((b) => ({
                beatId: b.id ?? "",
                query: (b.asset_query || b.label).replace(/\b3d\b/gi, "").trim(),
              }))
              .filter((p) => !!p.query);

            const queries = (beatQueryPairs.length
              ? beatQueryPairs.map((p) => p.query)
              : keywords
            ).slice(0, 6);

            try {
              const { byKeyword } = await ensure3DForKeywords(queries, 3, 18);
              const allIds = Array.from(new Set(Object.values(byKeyword).flat()));
              if (allIds.length) {
                const { data: rows } = await admin
                  .from("animation_components")
                  .select("id, name, slug, provider, video_url, lottie_url, thumbnail_url, external_id, color_support, tags")
                  .in("id", allIds);
                const rowById = new Map<string, any>((rows ?? []).map((r: any) => [r.id, r]));

                // Walk per-keyword so we can stamp beat_id + source_query
                for (const [kw, ids] of Object.entries(byKeyword)) {
                  const beatId = beatQueryPairs.find((p) => p.query === kw)?.beatId;
                  for (const id of ids) {
                    const r = rowById.get(id);
                    if (!r || candidates.some((c) => c.id === r.id && c.beat_id === beatId)) continue;
                    candidates.unshift({
                      id: r.id,
                      name: r.name,
                      slug: r.slug,
                      provider: r.provider,
                      preview_url: r.thumbnail_url ?? r.video_url ?? r.lottie_url,
                      video_url: r.video_url,
                      lottie_url: r.lottie_url,
                      external_id: r.external_id,
                      color_support: r.color_support ?? "fixed",
                      tags: [...(r.tags ?? []), "3d"],
                      beat_id: beatId,
                      source_query: kw,
                    });
                  }
                }
              }
            } catch (e) {
              console.error("ensure3DForKeywords", (e as Error).message);
            }
          }

          const candById = new Map(candidates.map((c) => [c.id, c]));

          const prompt = buildUserPrompt({
            theme: themeName,
            narration,
            word_timings: wt,
            duration_ms: durationMs,
            candidates,
            instruction: data.instruction,
            storyboard: data.storyboardHint as StoryboardBeatHint[] | undefined,
          });
          const plan = await callDirectorLLM(prompt, apiKey);
          if (!plan || !plan.elements?.length) {
            return { sceneId: s.id, inserted: 0, fallback: true, plan: null };
          }
          const rows = compilePlan(s.id, durationMs, wt, candById, plan);
          if (rows.length === 0) return { sceneId: s.id, inserted: 0, fallback: true, plan };

          const { error } = await admin.from("scene_elements").insert(rows);
          if (error) {
            console.error("director insert error", error);
            return { sceneId: s.id, inserted: 0, fallback: true, plan };
          }
          // Persist plan for later refinement
          await admin
            .from("scenes")
            .update({ director_plan: plan as unknown as never })
            .eq("id", s.id);
          return { sceneId: s.id, inserted: rows.length, fallback: false, plan };
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          totalElements += r.value.inserted;
          if (r.value.inserted > 0) scenesPlanned += 1;
          if (r.value.fallback) scenesFallback += 1;
        } else {
          scenesFallback += 1;
        }
      }
    }

    return {
      sceneCount: list.length,
      scenesPlanned,
      scenesFallback,
      elementsInserted: totalElements,
    };
  });
