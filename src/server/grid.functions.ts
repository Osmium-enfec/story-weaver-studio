import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { LAYOUTS, getLayout, autoPickLayout, type LayoutPreset } from "@/lib/layouts";

/**
 * Stage 1 of the 3-stage director flow: GRID.
 * Proposes 3 layout candidates for a scene; user picks one before the
 * infographic (storyboard) and animation stages run.
 */

function getAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface GridOption {
  id: string;
  name: string;
  description: string;
  beatCount: number;
  svg: string;
}

function estimateBeatCount(narration: string, durationMs: number): number {
  const words = (narration || "").trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return Math.max(2, Math.min(5, Math.round(durationMs / 2500)));
  // ~12 words per beat, clamp 2..6
  return Math.max(2, Math.min(6, Math.round(words / 12)));
}

function renderLayoutSvg(layout: LayoutPreset, n: number): string {
  const W = 160;
  const H = 90;
  const rects = layout.rects(n);
  const cells = rects
    .map((r, i) => {
      const x = Math.round(r.x * W);
      const y = Math.round(r.y * H);
      const w = Math.round(r.w * W);
      const h = Math.round(r.h * H);
      const fill = i === 0 ? "#6366f1" : "#cbd5e1";
      const text = i === 0 ? "#ffffff" : "#0f172a";
      const fontSize = Math.max(7, Math.min(10, Math.round(Math.min(w, h) * 0.45)));
      return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" ry="6" fill="${fill}" opacity="${i === 0 ? 0.9 : 0.7}"/><text x="${x + w / 2}" y="${y + h / 2 + 4}" font-family="Inter, system-ui, sans-serif" font-size="12" font-weight="700" fill="${text}" text-anchor="middle">${i + 1}</text></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">${cells}</svg>`;
}

function pickAlternatives(primary: LayoutPreset, beatCount: number): LayoutPreset[] {
  // Score by overlap with bestFor range, exclude primary, take top 2.
  const others = LAYOUTS.filter((l) => l.id !== primary.id)
    .map((l) => {
      const inRange = beatCount >= l.bestFor.min && beatCount <= l.bestFor.max ? 0 : 1;
      const distance = inRange === 0 ? 0 : Math.min(
        Math.abs(beatCount - l.bestFor.min),
        Math.abs(beatCount - l.bestFor.max),
      );
      return { l, score: inRange * 10 + distance };
    })
    .sort((a, b) => a.score - b.score)
    .map((x) => x.l);
  return [primary, others[0], others[1]].filter(Boolean) as LayoutPreset[];
}

interface SceneRow {
  id: string;
  narration: string | null;
  duration_ms: number | null;
  storyboard: { beats?: unknown[]; layout?: string } | null;
}

async function fetchScene(admin: ReturnType<typeof getAdmin>, sceneId: string): Promise<SceneRow> {
  const { data, error } = await admin
    .from("scenes")
    .select("id, narration, duration_ms, storyboard")
    .eq("id", sceneId)
    .single();
  if (error || !data) throw new Error("Scene not found");
  return data as unknown as SceneRow;
}

export const proposeGrid = createServerFn({ method: "POST" })
  .inputValidator((d: { sceneId: string }) =>
    z.object({ sceneId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const admin = getAdmin();
    const scene = await fetchScene(admin, data.sceneId);
    const existingBeats = Array.isArray(scene.storyboard?.beats) ? scene.storyboard!.beats!.length : 0;
    const beatCount = existingBeats > 0
      ? existingBeats
      : estimateBeatCount(scene.narration ?? "", scene.duration_ms ?? 5000);

    const primary = autoPickLayout(beatCount);
    const layouts = pickAlternatives(primary, beatCount);
    const options: GridOption[] = layouts.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      beatCount,
      svg: renderLayoutSvg(l, beatCount),
    }));

    // Persist proposals + advance stage
    const nextStoryboard = { ...(scene.storyboard ?? {}), layoutOptions: options.map((o) => o.id), suggestedBeatCount: beatCount };
    await admin
      .from("scenes")
      .update({
        director_stage: "grid",
        storyboard: nextStoryboard as unknown as never,
      })
      .eq("id", data.sceneId);

    return { stage: "grid" as const, beatCount, options };
  });

export const chooseGrid = createServerFn({ method: "POST" })
  .inputValidator((d: { sceneId: string; layoutId: string }) =>
    z.object({
      sceneId: z.string().uuid(),
      layoutId: z.string().min(1).max(64),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const layout = getLayout(data.layoutId);
    if (!layout) throw new Error(`Unknown layout: ${data.layoutId}`);
    const admin = getAdmin();
    const scene = await fetchScene(admin, data.sceneId);
    const next = {
      ...(scene.storyboard ?? {}),
      layout: layout.id,
      layoutName: layout.name,
    };
    await admin
      .from("scenes")
      .update({
        director_stage: "infographic",
        storyboard: next as unknown as never,
      })
      .eq("id", data.sceneId);
    return { stage: "infographic" as const, layoutId: layout.id, layoutName: layout.name };
  });

export const setDirectorStage = createServerFn({ method: "POST" })
  .inputValidator((d: { sceneId: string; stage: "idle" | "grid" | "infographic" | "animation" | "done" }) =>
    z.object({
      sceneId: z.string().uuid(),
      stage: z.enum(["idle", "grid", "infographic", "animation", "done"]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const admin = getAdmin();
    await admin.from("scenes").update({ director_stage: data.stage }).eq("id", data.sceneId);
    return { stage: data.stage };
  });
