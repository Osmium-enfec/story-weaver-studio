// Pending-theme handoff: CreateProjectDialog stores the user's chosen theme
// keyed by projectId, then the script route consumes it once on first load.

import type { SceneBackground } from "@/components/BackgroundPicker";
import { supabase } from "@/integrations/supabase/client";
import { ensureGoogleFont, saveTextRoles, type TextRoles } from "@/components/TextPanel";
import {
  FIREBASE_BACKGROUNDS,
  FIREBASE_TEXT_ROLES,
  applyFirebaseFonts,
  backgroundFromAsset,
} from "@/lib/firebase-theme";

export type PendingTheme =
  | { kind: "none" }
  | { kind: "firebase" }
  | { kind: "saved"; themeId: string };

const STORAGE_PREFIX = "pending-theme:";

export function setPendingTheme(projectId: string, theme: PendingTheme) {
  if (theme.kind === "none") return;
  try { localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(theme)); } catch { /* noop */ }
}

export function consumePendingTheme(projectId: string): PendingTheme | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + projectId);
    if (!raw) return null;
    localStorage.removeItem(STORAGE_PREFIX + projectId);
    return JSON.parse(raw) as PendingTheme;
  } catch { return null; }
}

interface ResolvedTheme {
  background: SceneBackground | null;
  fonts: TextRoles | null;
}

export async function resolveTheme(theme: PendingTheme): Promise<ResolvedTheme> {
  if (theme.kind === "firebase") {
    return {
      background: backgroundFromAsset(FIREBASE_BACKGROUNDS[0]),
      fonts: FIREBASE_TEXT_ROLES,
    };
  }
  if (theme.kind === "saved") {
    const { data } = await supabase
      .from("user_themes")
      .select("data")
      .eq("id", theme.themeId)
      .single();
    const d = (data?.data ?? {}) as {
      backgrounds?: { url: string; kind: "image" | "video" | "animation" }[];
      fonts?: TextRoles;
    };
    const first = d.backgrounds?.[0];
    let bg: SceneBackground | null = null;
    if (first) {
      bg = first.kind === "video"
        ? { type: "video", value: first.url }
        : first.kind === "animation"
          ? { type: "lottie", value: first.url }
          : { type: "image", value: first.url };
    }
    return { background: bg, fonts: d.fonts ?? null };
  }
  return { background: null, fonts: null };
}

/** Apply theme defaults globally (fonts) and return a background for scenes. */
export async function applyPendingTheme(theme: PendingTheme): Promise<SceneBackground | null> {
  if (theme.kind === "firebase") {
    applyFirebaseFonts();
    return backgroundFromAsset(FIREBASE_BACKGROUNDS[0]);
  }
  const resolved = await resolveTheme(theme);
  if (resolved.fonts) {
    Object.values(resolved.fonts).forEach((r) => ensureGoogleFont(r.family));
    saveTextRoles(resolved.fonts);
  }
  return resolved.background;
}
