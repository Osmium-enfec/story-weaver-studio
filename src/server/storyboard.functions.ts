import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { directProject, type StoryboardBeatHint } from "./director.functions";
import { getLayout } from "@/lib/layouts";

/**
 * Storyboard step — runs BEFORE animation. Produces a 3-7 beat infographic
 * (text + arrow SVG) for one canvas, lets the user refine it in chat, then
 * approve. On approval, calls the Director with the beats as a hint so the
 * resulting animation follows the approved order and timing.
 */

function getAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface StoryboardBeat {
  id: string;
  label: string;
  kind: "title" | "icon" | "code" | "diagram" | "callout" | "image" | "animation";
  asset_query?: string;
  anchor_word_index: number;
  narration_excerpt?: string;
  next?: string | null;
}

export interface Storyboard {
  status: "draft" | "approved";
  beats: StoryboardBeat[];
  svg: string;
  updated_at: string;
}

const BEAT_KINDS = ["title", "icon", "code", "diagram", "callout", "image", "animation"] as const;

const STORYBOARD_TOOL = {
  type: "function" as const,
  function: {
    name: "propose_storyboard",
    description:
      "Plan a single canvas as a sequence of 3-7 visual beats that flow with the narration. Each beat is one element on screen, in order.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["beats"],
      properties: {
        rationale: { type: "string", description: "1 sentence summary of the visual flow." },
        beats: {
          type: "array",
          minItems: 2,
          maxItems: 7,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "kind", "anchor_word_index"],
            properties: {
              label: { type: "string", description: "Short on-screen label (max 6 words)." },
              kind: { type: "string", enum: [...BEAT_KINDS] },
              asset_query: {
                type: "string",
                description: "2-4 keyword query to find an icon/image for this beat. Use for kind=icon/image/diagram.",
              },
              anchor_word_index: {
                type: "integer",
                minimum: 0,
                description: "Index into word_timings — beat appears just before this word is spoken.",
              },
              narration_excerpt: {
                type: "string",
                description: "Short snippet of narration this beat illustrates.",
              },
            },
          },
        },
      },
    },
  },
};

const STORYBOARD_SYSTEM = `You are a senior educational motion designer.
Plan ONE canvas as a clear visual sequence (an infographic) that explains the narration.
Rules:
- 3 to 7 beats. Each beat is ONE element appearing on screen, in temporal order.
- Beat 1 is usually a title or hook. Final beat is usually a recap, callout, or result.
- Pick the right "kind" per beat: title (heading), icon (concept icon), code (code snippet), diagram (relationship), callout (key term), image (illustration).
- Anchor each beat to a word_timings index where the concept is spoken so the animation can sync to voice.
- Keep labels punchy (max 6 words).
- For icon/image/diagram beats, give a 2-4 keyword asset_query so we can search the library.
- Output via the propose_storyboard tool only.`;

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

interface SceneRow {
  id: string;
  narration: string | null;
  duration_ms: number | null;
  word_timings: { text: string; start_ms: number; end_ms: number }[] | null;
  storyboard: Partial<Storyboard> | null;
  project_id: string;
}

async function fetchScene(admin: ReturnType<typeof getAdmin>, sceneId: string): Promise<SceneRow> {
  const { data, error } = await admin
    .from("scenes")
    .select("id, narration, duration_ms, word_timings, storyboard, project_id")
    .eq("id", sceneId)
    .single();
  if (error || !data) throw new Error("Scene not found");
  return data as unknown as SceneRow;
}

function escapeXml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kindGlyph(kind: StoryboardBeat["kind"]): string {
  switch (kind) {
    case "title": return "T";
    case "icon": return "★";
    case "code": return "</>";
    case "diagram": return "◆";
    case "callout": return "!";
    case "image": return "▣";
    case "animation": return "▶";
    default: return "•";
  }
}

function kindColor(kind: StoryboardBeat["kind"]): string {
  switch (kind) {
    case "title": return "#6366f1";
    case "icon": return "#06b6d4";
    case "code": return "#0f172a";
    case "diagram": return "#14b8a6";
    case "callout": return "#f59e0b";
    case "image": return "#ec4899";
    case "animation": return "#8b5cf6";
    default: return "#64748b";
  }
}

/**
 * Render the storyboard SVG. When `layoutId` matches a known LayoutPreset,
 * beats are placed inside that layout's slots so the chat preview reflects
 * the grid the user picked in stage 1. Otherwise we fall back to a flow grid.
 */
function renderBeatsSvg(beats: StoryboardBeat[], layoutId?: string | null): string {
  const layout = layoutId ? getLayout(layoutId) : null;

  if (layout && beats.length > 0) {
    const W = 480;
    const H = 270;
    const rects = layout.rects(beats.length);
    const cards = beats
      .map((b, i) => {
        const r = rects[i] ?? rects[rects.length - 1];
        const x = Math.round(r.x * W);
        const y = Math.round(r.y * H);
        const w = Math.round(r.w * W);
        const h = Math.round(r.h * H);
        const c = kindColor(b.kind);
        const label = escapeXml(b.label.length > 36 ? b.label.slice(0, 35) + "…" : b.label);
        const kindLabel = escapeXml(b.kind);
        const glyph = escapeXml(kindGlyph(b.kind));
        const headerH = Math.min(20, Math.max(14, Math.round(h * 0.18)));
        const fontSize = Math.max(9, Math.min(13, Math.round(Math.min(w, h) * 0.12)));
        return `
  <g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ry="8"
          fill="#ffffff" stroke="${c}" stroke-width="1.5"/>
    <rect x="${x}" y="${y}" width="${w}" height="${headerH}" rx="8" ry="8" fill="${c}"/>
    <rect x="${x}" y="${y + headerH / 2}" width="${w}" height="${headerH / 2}" fill="${c}"/>
    <text x="${x + 6}" y="${y + headerH - 5}" font-family="Inter, system-ui, sans-serif" font-size="9" fill="#ffffff" font-weight="600">${i + 1}. ${kindLabel}</text>
    <text x="${x + w - 6}" y="${y + headerH - 5}" font-family="Inter, system-ui, sans-serif" font-size="10" fill="#ffffff" text-anchor="end" font-weight="700">${glyph}</text>
    <foreignObject x="${x + 6}" y="${y + headerH + 4}" width="${Math.max(10, w - 12)}" height="${Math.max(10, h - headerH - 8)}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Inter,system-ui,sans-serif;font-size:${fontSize}px;color:#0f172a;line-height:1.2;font-weight:600;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">${label}</div>
    </foreignObject>
  </g>`;
      })
      .join("");
    const title = escapeXml(layout.name);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 18}" width="100%" style="max-width:${W}px;height:auto;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
  <text x="8" y="12" font-family="Inter, system-ui, sans-serif" font-size="10" fill="#64748b" font-weight="600">grid: ${title}</text>
  <g transform="translate(0, 18)">${cards}</g>
</svg>`;
  }

  // Fallback: flow layout (wraps after 4)
  const perRow = 4;
  const cardW = 140;
  const cardH = 86;
  const gapX = 36;
  const gapY = 28;
  const padX = 16;
  const padY = 16;
  const cols = Math.min(perRow, beats.length);
  const rows = Math.ceil(beats.length / perRow);
  const width = padX * 2 + cols * cardW + (cols - 1) * gapX;
  const height = padY * 2 + rows * cardH + (rows - 1) * gapY;

  const positions = beats.map((_, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    return { x: padX + col * (cardW + gapX), y: padY + row * (cardH + gapY) };
  });

  const cards = beats
    .map((b, i) => {
      const { x, y } = positions[i];
      const c = kindColor(b.kind);
      const label = escapeXml(b.label.length > 28 ? b.label.slice(0, 27) + "…" : b.label);
      const kindLabel = escapeXml(b.kind);
      const glyph = escapeXml(kindGlyph(b.kind));
      return `
  <g>
    <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="10" ry="10"
          fill="#ffffff" stroke="${c}" stroke-width="1.5"/>
    <rect x="${x}" y="${y}" width="${cardW}" height="20" rx="10" ry="10" fill="${c}"/>
    <rect x="${x}" y="${y + 10}" width="${cardW}" height="10" fill="${c}"/>
    <text x="${x + 8}" y="${y + 14}" font-family="Inter, system-ui, sans-serif" font-size="10" fill="#ffffff" font-weight="600">${i + 1}. ${kindLabel}</text>
    <text x="${x + cardW - 8}" y="${y + 14}" font-family="Inter, system-ui, sans-serif" font-size="11" fill="#ffffff" text-anchor="end" font-weight="700">${glyph}</text>
    <foreignObject x="${x + 8}" y="${y + 26}" width="${cardW - 16}" height="${cardH - 32}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Inter,system-ui,sans-serif;font-size:12px;color:#0f172a;line-height:1.25;font-weight:600;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">${label}</div>
    </foreignObject>
  </g>`;
    })
    .join("");

  const arrows = beats
    .slice(0, -1)
    .map((_, i) => {
      const a = positions[i];
      const b = positions[i + 1];
      const sameRow = Math.abs(a.y - b.y) < 1;
      if (sameRow) {
        const x1 = a.x + cardW;
        const x2 = b.x;
        const y = a.y + cardH / 2;
        return `<line x1="${x1}" y1="${y}" x2="${x2 - 4}" y2="${y}" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrow)"/>`;
      }
      const startX = a.x + cardW / 2;
      const startY = a.y + cardH;
      const endX = b.x + cardW / 2;
      const endY = b.y;
      const midY = (startY + endY) / 2;
      return `<path d="M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY - 4}" fill="none" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrow)"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px;height:auto;background:#f8fafc;border-radius:8px;">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/>
    </marker>
  </defs>
  ${cards}
  ${arrows}
</svg>`;
}

function normalizeBeats(raw: any[], wordCount: number): StoryboardBeat[] {
  return (Array.isArray(raw) ? raw : [])
    .map((b: any, i: number): StoryboardBeat | null => {
      if (!b || typeof b.label !== "string") return null;
      const kind = (BEAT_KINDS as readonly string[]).includes(b.kind) ? b.kind : "callout";
      const anchor = Math.max(
        0,
        Math.min(typeof b.anchor_word_index === "number" ? b.anchor_word_index : i, Math.max(0, wordCount - 1)),
      );
      return {
        id: `b${i + 1}`,
        label: String(b.label).slice(0, 80),
        kind,
        asset_query: typeof b.asset_query === "string" ? b.asset_query.slice(0, 60) : undefined,
        anchor_word_index: anchor,
        narration_excerpt: typeof b.narration_excerpt === "string" ? b.narration_excerpt.slice(0, 200) : undefined,
        next: null,
      };
    })
    .filter(Boolean) as StoryboardBeat[];
}

async function callStoryboardLLM(
  apiKey: string,
  scene: SceneRow,
  current: StoryboardBeat[] | null,
  instruction?: string,
): Promise<StoryboardBeat[] | null> {
  const narration = scene.narration ?? "";
  const durationMs = scene.duration_ms ?? 5000;
  const wt = scene.word_timings && scene.word_timings.length
    ? scene.word_timings
    : fakeTimings(narration, durationMs);
  const wtStr = wt.slice(0, 80).map((w, i) => `${i}:${w.text}`).join(" ");

  const userParts = [
    `Scene narration: ${narration}`,
    `Duration: ${durationMs}ms`,
    `word_timings (idx:text): ${wtStr}`,
  ];
  if (current && current.length) {
    userParts.push(
      "",
      "CURRENT STORYBOARD (refine this — keep what works, only change what the instruction asks):",
      current.map((b, i) => `${i + 1}. [${b.kind}] ${b.label} @ word ${b.anchor_word_index}${b.asset_query ? ` (query: ${b.asset_query})` : ""}`).join("\n"),
    );
  }
  if (instruction) userParts.push("", `USER INSTRUCTION: ${instruction}`);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: STORYBOARD_SYSTEM },
        { role: "user", content: userParts.join("\n") },
      ],
      tools: [STORYBOARD_TOOL],
      tool_choice: { type: "function", function: { name: "propose_storyboard" } },
      temperature: 0.5,
    }),
  });
  if (!res.ok) {
    console.error("Storyboard LLM", res.status, (await res.text()).slice(0, 400));
    return null;
  }
  const json = (await res.json()) as any;
  const args = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return null;
  try {
    const parsed = JSON.parse(args);
    return normalizeBeats(parsed.beats, wt.length);
  } catch (e) {
    console.error("Storyboard parse", e);
    return null;
  }
}

async function persistStoryboard(
  admin: ReturnType<typeof getAdmin>,
  sceneId: string,
  beats: StoryboardBeat[],
  status: "draft" | "approved",
  prevStoryboard: Partial<Storyboard> | null,
): Promise<Storyboard> {
  const linked = beats.map((b, i) => ({ ...b, next: i < beats.length - 1 ? beats[i + 1].id : null }));
  const prev = (prevStoryboard ?? {}) as Partial<Storyboard> & { layout?: string };
  const sb: Storyboard & { layout?: string; layoutName?: string; layoutOptions?: string[] } = {
    // Preserve grid-stage choices (layout, layoutName) across storyboard rewrites
    ...prev,
    status,
    beats: linked,
    svg: renderBeatsSvg(linked, prev.layout ?? null),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from("scenes")
    .update({
      storyboard: sb as unknown as never,
      director_stage: status === "approved" ? "animation" : "infographic",
    })
    .eq("id", sceneId);
  if (error) throw new Error(error.message);
  return sb;
}

export const planStoryboard = createServerFn({ method: "POST" })
  .inputValidator((d: { sceneId: string; instruction?: string }) =>
    z.object({ sceneId: z.string().uuid(), instruction: z.string().max(500).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    const admin = getAdmin();
    const scene = await fetchScene(admin, data.sceneId);
    const beats = await callStoryboardLLM(apiKey, scene, null, data.instruction);
    if (!beats || !beats.length) throw new Error("Could not generate a storyboard for this canvas");
    return await persistStoryboard(admin, scene.id, beats, "draft", scene.storyboard);
  });

export const refineStoryboard = createServerFn({ method: "POST" })
  .inputValidator((d: { sceneId: string; instruction: string }) =>
    z.object({ sceneId: z.string().uuid(), instruction: z.string().min(1).max(500) }).parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    const admin = getAdmin();
    const scene = await fetchScene(admin, data.sceneId);
    const current = (scene.storyboard?.beats ?? []) as StoryboardBeat[];
    const beats = await callStoryboardLLM(apiKey, scene, current.length ? current : null, data.instruction);
    if (!beats || !beats.length) throw new Error("Could not refine the storyboard");
    return await persistStoryboard(admin, scene.id, beats, "draft", scene.storyboard);
  });

export const approveAndAnimate = createServerFn({ method: "POST" })
  .inputValidator((d: { sceneId: string }) =>
    z.object({ sceneId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const admin = getAdmin();
    const scene = await fetchScene(admin, data.sceneId);
    const beats = (scene.storyboard?.beats ?? []) as StoryboardBeat[];
    if (!beats.length) throw new Error("No storyboard yet — generate one first");

    // Mark approved
    await persistStoryboard(admin, scene.id, beats, "approved", scene.storyboard);

    // Hand off to the Director with the storyboard as a hint
    const hint: StoryboardBeatHint[] = beats.map((b) => ({
      id: b.id,
      label: b.label,
      kind: b.kind,
      asset_query: b.asset_query,
      anchor_word_index: b.anchor_word_index,
      narration_excerpt: b.narration_excerpt,
    }));

    const res = await directProject({
      data: {
        projectId: scene.project_id,
        sceneId: scene.id,
        replace: true,
        storyboardHint: hint,
      },
    });
    await admin.from("scenes").update({ director_stage: "done" }).eq("id", scene.id);
    return { ok: true, ...res };
  });
