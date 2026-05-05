// Deterministic local scene splitting. AI-based splitting can come later via Edge Function.
import type { CourseType } from "./db-types";

export type SplitMode = "sentence" | "paragraph" | "concept" | "manual";

const CONCEPT_KEYWORDS: Record<string, string[]> = {
  variable: ["variable", "var ", "let ", "const "],
  "data type": ["int", "string", "boolean", "float"],
  list: ["list"],
  array: ["array"],
  loop: ["loop", "for ", "while "],
  "if else": ["if ", "else", "condition"],
  function: ["function", "def ", "method"],
  class: ["class "],
  object: ["object", "instance"],
  inheritance: ["inherit", "extends", "subclass"],
  "API request": ["api", "fetch", "http", "endpoint", "request"],
  "database table": ["table", "schema", "sql"],
  CRUD: ["crud", "create", "read", "update", "delete"],
  "Android activity": ["activity", "intent"],
  fragment: ["fragment"],
  RecyclerView: ["recyclerview"],
  "error handling": ["try", "catch", "except", "throw"],
};

export function detectConcepts(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [concept, keywords] of Object.entries(CONCEPT_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) found.push(concept);
  }
  return found;
}

export interface SplitScene {
  narration: string;
  visual_brief: string;
  detected_concepts: string[];
  duration_ms: number;
  suggested_animation: string | null;
}

const ANIMATION_BY_CONCEPT: Record<string, string> = {
  variable: "variable-box",
  loop: "for-loop",
  "if else": "if-else",
  function: "function-call",
  class: "class-diagram",
  object: "class-diagram",
  "API request": "api-request",
  "database table": "database-table",
  CRUD: "database-table",
  "Android activity": "android-activity",
};

function pickAnimation(concepts: string[]): string | null {
  for (const c of concepts) if (ANIMATION_BY_CONCEPT[c]) return ANIMATION_BY_CONCEPT[c];
  return concepts.length ? "code-block" : null;
}

function estimateDuration(text: string): number {
  // ~150 words per minute => 400ms per word, min 3s, max 12s
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(12000, Math.max(3000, words * 400));
}

function buildScene(narration: string, _course: CourseType): SplitScene {
  const trimmed = narration.trim();
  const concepts = detectConcepts(trimmed);
  return {
    narration: trimmed,
    visual_brief: concepts.length
      ? `Show animated ${concepts.join(", ")} relevant to the narration.`
      : `Simple visual illustrating: ${trimmed.slice(0, 80)}`,
    detected_concepts: concepts,
    duration_ms: estimateDuration(trimmed),
    suggested_animation: pickAnimation(concepts),
  };
}

export function splitScript(script: string, mode: SplitMode, course: CourseType): SplitScene[] {
  const clean = script.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  let chunks: string[] = [];
  if (mode === "manual") {
    chunks = clean.split(/\n?-{3,}\n?/);
  } else if (mode === "paragraph") {
    chunks = clean.split(/\n\s*\n+/);
  } else if (mode === "sentence") {
    chunks = clean.split(/(?<=[.!?])\s+(?=[A-Z])/);
  } else {
    // concept-based: split sentences then merge by shared concept; group up to 2 sentences per scene
    const sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z])/);
    const groups: string[] = [];
    let buf: string[] = [];
    let lastConcepts = "";
    for (const s of sentences) {
      const c = detectConcepts(s).sort().join("|");
      if (buf.length === 0 || (c && c === lastConcepts && buf.length < 2)) {
        buf.push(s);
        lastConcepts = c;
      } else {
        groups.push(buf.join(" "));
        buf = [s];
        lastConcepts = c;
      }
    }
    if (buf.length) groups.push(buf.join(" "));
    chunks = groups;
  }

  return chunks
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => buildScene(c, course));
}
