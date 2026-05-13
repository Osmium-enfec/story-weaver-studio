import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { ensure3DForKeywords, wants3D } from "./iconscout-3d.server";
import { ensureExternalForKeywords } from "./director-mirror.server";
import {
  LAYOUT_IDS,
  autoPickLayout,
  getLayout,
  layoutCatalogForPrompt,
  resolveLayoutPx,
} from "@/lib/layouts";

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
  /** New: slot index into the chosen layout (preferred over raw position). */
  slot?: number;
  /** Legacy: explicit normalized rect. Used as fallback when slot is missing. */
  position?: { x: number; y: number; w: number; h: number };
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
  layout?: string;
  scene_transition_in?: "cut" | "fade" | "slide" | "zoom";
  rationale?: string;
}

const PLAN_TOOL = {
  type: "function" as const,
  function: {
    name: "render_scene",
    description:
      "Produce a production-quality scene plan: pick a layout preset, place 2-6 elements in its slots, and time each entrance against word_timings for a natural reveal.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["elements", "layout"],
      properties: {
        scene_transition_in: { type: "string", enum: ["cut", "fade", "slide", "zoom"] },
        layout: {
          type: "string",
          enum: LAYOUT_IDS,
          description:
            "Composition preset to use. Pick the one whose 'best for' matches the number of beats AND whose feel matches the narration (compare → two-col-balance, list → title-and-row, story progression → diagonal-cascade or vertical-storyline, single hero → hero-left/right/center).",
        },
        rationale: { type: "string", description: "1-2 sentence summary of the creative direction." },
        elements: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "anchor_word_index", "duration_ms", "slot"],
            properties: {
              kind: { type: "string", enum: ["asset", "text"] },
              asset_id: {
                type: "string",
                description: "UUID from candidate_assets. REQUIRED when kind=asset. Omit for kind=text.",
              },
              text: { type: "string", description: "Text content. REQUIRED when kind=text." },
              text_role: { type: "string", enum: ["heading", "subheading", "caption"] },
              slot: {
                type: "integer",
                minimum: 0,
                maximum: 8,
                description: "Index into the chosen layout's slots (0-based). Slot order = visual reading order.",
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
- FIRST pick a layout preset that fits the beat count + narration tone (see layouts catalogue). Do NOT default to a 3x3 grid.
- Place 2 to 5 elements into the layout's slots (slot 0 = primary focal area).
- CRITICAL: every element MUST set anchor_word_index to the index of the spoken word it visually represents. This is non-negotiable — visuals that aren't tied to a word will be dropped. Pick the word whose meaning the visual depicts (e.g. an airplane icon → the word "fly", a chart → the word "growth").
- No two elements should share the same anchor_word_index unless they form a tight pair (heading + icon for the same concept).
- Keep at most 3 elements visible at the same instant.
- Pick assets ONLY from candidate_assets (use the exact UUID in asset_id). If nothing fits, use a "text" element.
- Use text for key terms, short callouts, or titles. Pair text with an asset when possible.
- Choose entrance animations deliberately: fade ambient, slide-up arriving, scale/bounce emphasis, word-reveal code, typewriter sparingly.
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
        `- id=${c.id} name="${c.name}" provider=${c.provider}${
          c.beat_id ? ` beat_id=${c.beat_id}` : ""
        }${c.source_query ? ` query="${c.source_query}"` : ""} tags=[${c.tags.slice(0, 5).join(",")}]`,
    )
    .join("\n");
  const sb = storyboard && storyboard.length
    ? "\nAPPROVED STORYBOARD (use exactly this order, ONE element per beat):\n" +
      storyboard
        .map(
          (b, i) =>
            `${i + 1}. beat_id=${b.id ?? `b${i + 1}`} kind=${b.kind} label="${b.label}"${
              b.asset_query ? ` query="${b.asset_query}"` : ""
            }${typeof b.anchor_word_index === "number" ? ` anchor_word_index=${b.anchor_word_index}` : ""}${
              b.narration_excerpt ? ` says="${b.narration_excerpt}"` : ""
            }`,
        )
        .join("\n") +
      `\n\nMAPPING RULES (CRITICAL — this keeps the visuals in sync with the voice):
- Produce exactly one element per beat, in the same order.
- For kind=icon/image/diagram: PREFER the candidate whose beat_id matches this beat. If none, fall back to one whose source_query / tags / name best matches the beat's query.
- For kind=title/code/callout: emit a "text" element with the beat's label.
- Use the beat's anchor_word_index AS the element's anchor_word_index — DO NOT shift it. This is what syncs the asset to the spoken word.
- duration_ms should cover from this beat's anchor word to the next beat's anchor word (or to the end of the scene for the last beat).`
    : "";
  return [
    `Theme: ${theme}`,
    `Scene duration: ${duration_ms}ms`,
    `Narration: ${narration}`,
    `word_timings (idx:text@start_ms): ${wt}`,
    "",
    "LAYOUT PRESETS (pick one for `layout`, then place each element in a `slot` index 0..N-1):",
    layoutCatalogForPrompt(),
    "",
    "candidate_assets (UUIDs you may reference; beat_id ties an asset to a specific beat):",
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

interface ThemeTokens {
  fg: string;
  accent: string;
  bg: string;
}

const DEFAULT_THEME_TOKENS: ThemeTokens = { fg: "#0f172a", accent: "#1f6feb", bg: "#ffffff" };

function compilePlan(
  sceneId: string,
  sceneDurationMs: number,
  wordTimings: { text: string; start_ms: number; end_ms: number }[],
  candidatesById: Map<string, CandidateAsset>,
  plan: ScenePlan,
  themeTokens: ThemeTokens,
): CompiledRow[] {
  const rows: CompiledRow[] = [];
  const els = plan.elements ?? [];
  const hasWords = wordTimings.length > 0;

  // Resolve which layout preset to use, then materialize its slot rects.
  const layout = (plan.layout && getLayout(plan.layout)) || autoPickLayout(els.length);
  const slotRects = resolveLayoutPx(layout, Math.max(els.length, 1));

  els.forEach((el, idx) => {
    // Word-anchor invariant: every element MUST bind to a real spoken word
    // when word_timings exist. Drop elements with missing/out-of-range anchors
    // so the timeline never shows visuals that don't match the voice.
    let wIdx = el.anchor_word_index ?? -1;
    if (hasWords) {
      if (!Number.isFinite(wIdx) || wIdx < 0 || wIdx >= wordTimings.length) {
        console.warn(`director: dropping element ${idx} — invalid anchor_word_index`, wIdx);
        return;
      }
    } else {
      wIdx = 0; // no words to bind to (silent scene)
    }

    const anchorWord = hasWords ? (wordTimings[wIdx]?.text ?? null) : null;
    const startMs = hasWords
      ? Math.max(0, (wordTimings[wIdx]?.start_ms ?? 0) - 80)
      : Math.round(idx * 400);
    const elementDur = Math.max(400, el.duration_ms ?? 2500);
    const endMs = Math.min(sceneDurationMs, startMs + elementDur);

    // Compute end_word_index from duration so the script panel can highlight
    // the FULL phrase this element covers, not just the single anchor word.
    let endWIdx = wIdx;
    if (hasWords) {
      for (let i = wIdx; i < wordTimings.length; i++) {
        if ((wordTimings[i]?.start_ms ?? 0) <= endMs) endWIdx = i;
        else break;
      }
    }

    // Position: prefer slot from chosen layout. Fall back to legacy normalized rect.
    let position: { x: number; y: number; w: number; h: number };
    const slotIdx = typeof el.slot === "number" ? el.slot : idx;
    if (slotRects[slotIdx]) {
      position = slotRects[slotIdx];
    } else if (el.position) {
      const px = Math.max(0, Math.min(1, el.position.x));
      const py = Math.max(0, Math.min(1, el.position.y));
      const pw = Math.max(0.05, Math.min(1 - px, el.position.w));
      const ph = Math.max(0.05, Math.min(1 - py, el.position.h));
      position = {
        x: Math.round(px * CANVAS_W),
        y: Math.round(py * CANVAS_H),
        w: Math.round(pw * CANVAS_W),
        h: Math.round(ph * CANVAS_H),
      };
    } else {
      position = slotRects[Math.min(idx, slotRects.length - 1)] ?? { x: 40, y: 40, w: 400, h: 300 };
    }

    if (el.kind === "text") {
      const role = el.text_role ?? "subheading";
      const sizeByRole: Record<string, number> = { heading: 72, subheading: 44, caption: 28 };
      const weightByRole: Record<string, number> = { heading: 700, subheading: 600, caption: 500 };
      // Theme-aware color: heading uses fg, caption uses fg @ 70%, subheading uses accent.
      const colorByRole: Record<string, string> = {
        heading: themeTokens.fg,
        subheading: themeTokens.accent,
        caption: themeTokens.fg,
      };
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
          word: anchorWord,
          start_word_index: hasWords ? wIdx : null,
          end_word_index: hasWords ? endWIdx : null,
          font_family: "Inter",
          font_size: sizeByRole[role] ?? 36,
          font_weight: weightByRole[role] ?? 600,
          line_height: 1.2,
          color: colorByRole[role] ?? themeTokens.fg,
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
    const type =
      asset.provider === "iconscout" || asset.provider === "ai-image" || asset.provider === "iconify" || asset.provider === "unsplash"
        ? "iconscout"
        : asset.provider === "lottie"
          ? "lottie"
          : "animation";
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
        word: anchorWord,
        start_word_index: hasWords ? wIdx : null,
        end_word_index: hasWords ? endWIdx : null,
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
        remove_background:
          asset.provider === "iconscout" ||
          asset.provider === "ai-image" ||
          asset.provider === "iconify",
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

/**
 * Smart fallback: when the LLM returns no usable plan, drop a centered
 * heading using the first words of the narration and (if a candidate is
 * available) place the highest-tag-overlap asset alongside it. Both are
 * anchored to real spoken words so the word-binding invariant holds.
 */
function buildFallbackRows(
  sceneId: string,
  sceneDurationMs: number,
  wordTimings: { text: string; start_ms: number; end_ms: number }[],
  candidates: CandidateAsset[],
  themeTokens: ThemeTokens,
  narration: string,
): CompiledRow[] {
  if (wordTimings.length === 0) return [];
  const headingText = (narration || "").trim().split(/\s+/).slice(0, 6).join(" ");
  const layout = autoPickLayout(2);
  const slots = resolveLayoutPx(layout, 2);
  const headingSlot = slots[0] ?? { x: 80, y: 80, w: 1120, h: 200 };
  const assetSlot = slots[1] ?? { x: 80, y: 320, w: 1120, h: 320 };

  const rows: CompiledRow[] = [];
  const headingStart = Math.max(0, (wordTimings[0]?.start_ms ?? 0) - 80);
  rows.push({
    scene_id: sceneId,
    type: "text",
    position: headingSlot,
    z_index: 0,
    start_ms: headingStart,
    end_ms: sceneDurationMs,
    content: {
      provider: "internal",
      name: "Text",
      text: headingText,
      role: "heading",
      word: wordTimings[0]?.text ?? null,
      start_word_index: 0,
      end_word_index: Math.min(5, wordTimings.length - 1),
      font_family: "Inter",
      font_size: 72,
      font_weight: 700,
      line_height: 1.2,
      color: themeTokens.fg,
      text_animation: { type: "fade", duration: 500, delay: 0, easing: "ease-out" },
    },
  });

  const asset = candidates.find((c) => c.video_url || c.lottie_url) ?? candidates[0];
  if (asset) {
    const midIdx = Math.floor(wordTimings.length / 2);
    const midStart = Math.max(0, (wordTimings[midIdx]?.start_ms ?? 0) - 80);
    rows.push({
      scene_id: sceneId,
      type:
        asset.provider === "iconscout" || asset.provider === "ai-image" || asset.provider === "iconify" || asset.provider === "unsplash"
          ? "iconscout"
          : asset.provider === "lottie"
            ? "lottie"
            : "animation",
      position: assetSlot,
      z_index: 1,
      start_ms: midStart,
      end_ms: sceneDurationMs,
      content: {
        provider: asset.provider,
        name: asset.name,
        slug: asset.slug,
        word: wordTimings[midIdx]?.text ?? null,
        start_word_index: midIdx,
        end_word_index: wordTimings.length - 1,
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
        remove_background:
          asset.provider === "iconscout" ||
          asset.provider === "ai-image" ||
          asset.provider === "iconify",
        text_animation: { type: "scale", duration: 600, delay: 0, easing: "ease-out" },
      },
    });
  }
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

    // Fetch theme design tokens so text colors match the project palette
    // (no more black-on-black on dark themes).
    const { data: themeRow } = await admin
      .from("themes")
      .select("design_tokens")
      .eq("name", themeName)
      .maybeSingle();
    const tokens = (themeRow?.design_tokens ?? {}) as Partial<ThemeTokens>;
    const themeTokens: ThemeTokens = {
      fg: tokens.fg ?? DEFAULT_THEME_TOKENS.fg,
      accent: tokens.accent ?? DEFAULT_THEME_TOKENS.accent,
      bg: tokens.bg ?? DEFAULT_THEME_TOKENS.bg,
    };

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

          // Live-mirror Iconify + Unsplash for the keywords most likely to
          // need imagery. Skip keywords that already have ≥2 playable local
          // candidates to avoid wasting API calls.
          try {
            const localByKw = new Map<string, number>();
            for (const c of candidates) {
              const k = c.source_query;
              if (k) localByKw.set(k, (localByKw.get(k) ?? 0) + 1);
            }
            const sbHint2 = data.storyboardHint as StoryboardBeatHint[] | undefined;
            const sbBeatQueries = (sbHint2 ?? [])
              .filter((b) => b.kind === "icon" || b.kind === "image" || b.kind === "diagram")
              .map((b) => ({ beatId: b.id ?? "", query: (b.asset_query || b.label).trim() }))
              .filter((p) => !!p.query);
            const externalQueries = (sbBeatQueries.length ? sbBeatQueries.map((p) => p.query) : keywords)
              .filter((kw) => (localByKw.get(kw) ?? 0) < 2)
              .slice(0, 6);

            if (externalQueries.length) {
              const { byKeyword } = await ensureExternalForKeywords(externalQueries, {
                iconsPerKeyword: 2,
                photosPerKeyword: 1,
                totalCap: 12,
              });
              const allIds = Array.from(new Set(Object.values(byKeyword).flat()));
              if (allIds.length) {
                const { data: rows } = await admin
                  .from("animation_components")
                  .select("id, name, slug, provider, video_url, lottie_url, thumbnail_url, external_id, color_support, tags")
                  .in("id", allIds);
                const rowById = new Map<string, any>((rows ?? []).map((r: any) => [r.id, r]));
                for (const [kw, ids] of Object.entries(byKeyword)) {
                  const beatId = sbBeatQueries.find((p) => p.query === kw)?.beatId;
                  for (const id of ids) {
                    const r = rowById.get(id);
                    if (!r || candidates.some((c) => c.id === r.id)) continue;
                    candidates.push({
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
                      beat_id: beatId,
                      source_query: kw,
                    });
                  }
                }
              }
            }
          } catch (e) {
            console.error("ensureExternalForKeywords", (e as Error).message);
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

          // Smart fallback: if LLM returns no plan or compile produces 0 rows,
          // drop a centered heading + best candidate so the scene is never blank.
          let rows: CompiledRow[] = [];
          let usedFallback = false;
          if (plan && plan.elements?.length) {
            rows = compilePlan(s.id, durationMs, wt, candById, plan, themeTokens);
          }
          if (rows.length === 0) {
            rows = buildFallbackRows(s.id, durationMs, wt, candidates, themeTokens, narration);
            usedFallback = true;
          }
          if (rows.length === 0) {
            return { sceneId: s.id, inserted: 0, fallback: true, plan: plan ?? null };
          }

          const { error } = await admin.from("scene_elements").insert(rows);
          if (error) {
            console.error("director insert error", error);
            return { sceneId: s.id, inserted: 0, fallback: true, plan: plan ?? null };
          }
          // Persist plan for later refinement
          await admin
            .from("scenes")
            .update({ director_plan: (plan ?? { fallback: true }) as unknown as never })
            .eq("id", s.id);
          return { sceneId: s.id, inserted: rows.length, fallback: usedFallback, plan: plan ?? null };
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
