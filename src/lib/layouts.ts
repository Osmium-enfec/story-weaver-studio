// Modern composition presets for the AI Director.
// Each preset returns N normalized rects (0..1 in design space) for N beats.
// Director picks one preset by name and we resolve concrete pixel rects.

import { DESIGN } from "./grid";

export type LayoutId =
  | "hero-left"
  | "hero-right"
  | "hero-center-stack"
  | "title-and-row"
  | "two-col-balance"
  | "z-flow"
  | "diagonal-cascade"
  | "mosaic-asymmetric"
  | "vertical-storyline"
  | "grid-3x3";

export interface LayoutPreset {
  id: LayoutId;
  name: string;
  description: string;
  /** Best for this many beats. */
  bestFor: { min: number; max: number };
  /** Returns N normalized rects (x, y, w, h all in 0..1). */
  rects: (n: number) => { x: number; y: number; w: number; h: number }[];
}

const r = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

export const LAYOUTS: LayoutPreset[] = [
  {
    id: "hero-left",
    name: "Hero left",
    description: "Big focal element on the left, supporting beats stacked on the right.",
    bestFor: { min: 2, max: 4 },
    rects: (n) => {
      const out = [r(0.03, 0.12, 0.5, 0.76)];
      const right = Math.max(1, n - 1);
      const h = 0.76 / right;
      for (let i = 0; i < right; i++) out.push(r(0.57, 0.12 + i * h + 0.02, 0.4, h - 0.04));
      return out.slice(0, n);
    },
  },
  {
    id: "hero-right",
    name: "Hero right",
    description: "Mirror of hero-left — focal on the right, beats stacked left.",
    bestFor: { min: 2, max: 4 },
    rects: (n) => {
      const out = [r(0.47, 0.12, 0.5, 0.76)];
      const left = Math.max(1, n - 1);
      const h = 0.76 / left;
      for (let i = 0; i < left; i++) out.push(r(0.03, 0.12 + i * h + 0.02, 0.4, h - 0.04));
      return out.slice(0, n);
    },
  },
  {
    id: "hero-center-stack",
    name: "Hero center stack",
    description: "Centered title above, large visual below — strong landing shot.",
    bestFor: { min: 2, max: 3 },
    rects: (n) => {
      if (n <= 2) return [r(0.15, 0.06, 0.7, 0.18), r(0.18, 0.28, 0.64, 0.66)];
      return [r(0.15, 0.04, 0.7, 0.14), r(0.18, 0.22, 0.64, 0.58), r(0.25, 0.83, 0.5, 0.13)];
    },
  },
  {
    id: "title-and-row",
    name: "Title + row",
    description: "Title across the top, a horizontal row of equal-width beats below.",
    bestFor: { min: 3, max: 5 },
    rects: (n) => {
      const out = [r(0.06, 0.06, 0.88, 0.18)];
      const cols = Math.max(1, n - 1);
      const w = 0.88 / cols;
      for (let i = 0; i < cols; i++) out.push(r(0.06 + i * w + 0.01, 0.32, w - 0.02, 0.6));
      return out.slice(0, n);
    },
  },
  {
    id: "two-col-balance",
    name: "Two-column balance",
    description: "Left/right columns, each with stacked beats — good for compare/contrast.",
    bestFor: { min: 2, max: 6 },
    rects: (n) => {
      const out: ReturnType<typeof r>[] = [];
      const perCol = Math.ceil(n / 2);
      const h = 0.88 / perCol;
      for (let i = 0; i < n; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        out.push(r(col === 0 ? 0.04 : 0.52, 0.06 + row * h + 0.01, 0.44, h - 0.02));
      }
      return out;
    },
  },
  {
    id: "z-flow",
    name: "Z-flow",
    description: "Beats trace a Z-pattern across the canvas — natural reading flow.",
    bestFor: { min: 3, max: 5 },
    rects: (n) => {
      const slots = [
        r(0.04, 0.08, 0.36, 0.34),
        r(0.6, 0.08, 0.36, 0.34),
        r(0.32, 0.36, 0.36, 0.32),
        r(0.04, 0.62, 0.36, 0.32),
        r(0.6, 0.62, 0.36, 0.32),
      ];
      return slots.slice(0, n);
    },
  },
  {
    id: "diagonal-cascade",
    name: "Diagonal cascade",
    description: "Each beat steps down and right — implies progression.",
    bestFor: { min: 3, max: 5 },
    rects: (n) => {
      const w = 0.42, h = 0.36;
      const stepX = (1 - w - 0.06) / Math.max(1, n - 1);
      const stepY = (1 - h - 0.06) / Math.max(1, n - 1);
      return Array.from({ length: n }, (_, i) => r(0.03 + i * stepX, 0.05 + i * stepY, w, h));
    },
  },
  {
    id: "mosaic-asymmetric",
    name: "Mosaic asymmetric",
    description: "One large + several smaller blocks at varied sizes — editorial feel.",
    bestFor: { min: 3, max: 5 },
    rects: (n) => {
      const slots = [
        r(0.04, 0.06, 0.56, 0.6),
        r(0.64, 0.06, 0.32, 0.28),
        r(0.64, 0.38, 0.32, 0.28),
        r(0.04, 0.7, 0.4, 0.24),
        r(0.48, 0.7, 0.48, 0.24),
      ];
      return slots.slice(0, n);
    },
  },
  {
    id: "vertical-storyline",
    name: "Vertical storyline",
    description: "Beats stack top-to-bottom on the left with text on the right — timeline.",
    bestFor: { min: 3, max: 5 },
    rects: (n) => {
      const out: ReturnType<typeof r>[] = [];
      const h = 0.88 / n;
      for (let i = 0; i < n; i++) out.push(r(0.06, 0.06 + i * h + 0.01, 0.88, h - 0.02));
      return out;
    },
  },
  {
    id: "grid-3x3",
    name: "3×3 grid",
    description: "Classic 3×3 cell grid — only when the script lists many parallel items.",
    bestFor: { min: 6, max: 9 },
    rects: (n) => {
      const out: ReturnType<typeof r>[] = [];
      for (let i = 0; i < n && i < 9; i++) {
        const col = i % 3, row = Math.floor(i / 3);
        out.push(r(0.04 + col * 0.32, 0.06 + row * 0.31, 0.28, 0.27));
      }
      return out;
    },
  },
];

export const LAYOUT_IDS = LAYOUTS.map((l) => l.id);

export function getLayout(id: string): LayoutPreset | null {
  return LAYOUTS.find((l) => l.id === id) ?? null;
}

/** Pick a layout when the LLM didn't specify one — heuristic by beat count. */
export function autoPickLayout(beatCount: number): LayoutPreset {
  if (beatCount <= 2) return getLayout("hero-center-stack")!;
  if (beatCount === 3) return getLayout("title-and-row")!;
  if (beatCount === 4) return getLayout("z-flow")!;
  if (beatCount === 5) return getLayout("mosaic-asymmetric")!;
  return getLayout("grid-3x3")!;
}

/** Resolve normalized rects to design pixel rects. */
export function resolveLayoutPx(layout: LayoutPreset, n: number) {
  return layout.rects(n).map((rect) => ({
    x: Math.round(rect.x * DESIGN.w),
    y: Math.round(rect.y * DESIGN.h),
    w: Math.round(rect.w * DESIGN.w),
    h: Math.round(rect.h * DESIGN.h),
  }));
}

/** Brief catalogue string for the LLM. */
export function layoutCatalogForPrompt(): string {
  return LAYOUTS.map(
    (l) => `- ${l.id}: ${l.description} (best for ${l.bestFor.min}-${l.bestFor.max} beats)`,
  ).join("\n");
}
