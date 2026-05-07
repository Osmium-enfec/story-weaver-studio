// Shared design-space + 3x3 grid system for editor and preview.
export const DESIGN = { w: 1280, h: 720 } as const;
export const GRID = { cols: 3, rows: 3, pad: 48 } as const;

export interface Rect { x: number; y: number; w: number; h: number }

export function clampRectToDesign(rect: Rect): Rect {
  const w = Math.max(24, Math.min(Math.round(rect.w), DESIGN.w));
  const h = Math.max(24, Math.min(Math.round(rect.h), DESIGN.h));
  return {
    x: Math.max(0, Math.min(Math.round(rect.x), DESIGN.w - w)),
    y: Math.max(0, Math.min(Math.round(rect.y), DESIGN.h - h)),
    w,
    h,
  };
}

export function cellRect(index: number): Rect {
  const cellW = DESIGN.w / GRID.cols;
  const cellH = DESIGN.h / GRID.rows;
  const i = Math.max(0, Math.min(GRID.cols * GRID.rows - 1, index));
  const r = Math.floor(i / GRID.cols);
  const c = i % GRID.cols;
  return {
    x: Math.round(c * cellW + GRID.pad),
    y: Math.round(r * cellH + GRID.pad),
    w: Math.round(cellW - GRID.pad * 2),
    h: Math.round(cellH - GRID.pad * 2),
  };
}

export function allCellRects(n: number = GRID.cols * GRID.rows): Rect[] {
  return Array.from({ length: Math.min(n, GRID.cols * GRID.rows) }, (_, i) => cellRect(i));
}

// Find the first grid cell whose center is not already occupied by an existing element.
export function nextEmptyCellIndex(used: { x: number; y: number; w: number; h: number }[]): number {
  const total = GRID.cols * GRID.rows;
  for (let i = 0; i < total; i++) {
    const r = cellRect(i);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const occupied = used.some(
      (u) => cx >= u.x && cx <= u.x + u.w && cy >= u.y && cy <= u.y + u.h,
    );
    if (!occupied) return i;
  }
  return total - 1; // all full → fallback to last cell
}
