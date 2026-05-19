import { useEffect, useRef, useState } from "react";
import type { AnimationBlockContent } from "@/components/AnimationBlock";

export interface TimelineElement {
  id: string;
  type: string;
  content: AnimationBlockContent;
  start_ms: number;
  end_ms: number;
  z_index: number;
}

interface Props {
  sceneId: string;
  durationMs: number;
  elements: TimelineElement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChangeTimes: (id: string, start_ms: number, end_ms: number) => void;
  onChangeDuration?: (durationMs: number) => void;
}

const TRACK_PX_PER_MS = 0.08; // 1000ms => 80px (default; can be zoomed later)
const ROW_HEIGHT = 28;
const ROW_GAP = 6;
const MIN_CLIP_MS = 200;

function fmt(ms: number) {
  const s = Math.max(0, ms) / 1000;
  return s.toFixed(s < 10 ? 1 : 0) + "s";
}

function clipLabel(el: TimelineElement) {
  const c = el.content;
  if (c.text) return c.text.slice(0, 24);
  if (c.role) return c.role;
  if (c.shape_type) return String(c.shape_type).replace(/-/g, " ");
  return c.name || el.type;
}

export function TimelineEditor({
  sceneId,
  durationMs,
  elements,
  selectedId,
  onSelect,
  onChangeTimes,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const pxPerMs = TRACK_PX_PER_MS * zoom;
  const widthPx = Math.max(400, durationMs * pxPerMs);

  const [drag, setDrag] = useState<
    | null
    | {
        id: string;
        mode: "move" | "resize-l" | "resize-r";
        originX: number;
        startStart: number;
        startEnd: number;
      }
  >(null);

  useEffect(() => {
    if (!drag) return;
    function onMove(e: MouseEvent) {
      if (!drag) return;
      const deltaPx = e.clientX - drag.originX;
      const deltaMs = Math.round(deltaPx / pxPerMs);
      let s = drag.startStart;
      let en = drag.startEnd;
      if (drag.mode === "move") {
        const len = drag.startEnd - drag.startStart;
        s = Math.max(0, Math.min(durationMs - len, drag.startStart + deltaMs));
        en = s + len;
      } else if (drag.mode === "resize-l") {
        s = Math.max(0, Math.min(drag.startEnd - MIN_CLIP_MS, drag.startStart + deltaMs));
      } else {
        en = Math.max(drag.startStart + MIN_CLIP_MS, Math.min(durationMs, drag.startEnd + deltaMs));
      }
      onChangeTimes(drag.id, s, en);
    }
    function onUp() {
      setDrag(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, pxPerMs, durationMs, onChangeTimes]);

  // Sort by z_index but render each as its own row for clarity
  const ordered = [...elements].sort((a, b) => a.z_index - b.z_index);

  const ticks: number[] = [];
  const tickStep = durationMs <= 8000 ? 1000 : durationMs <= 30000 ? 2000 : 5000;
  for (let t = 0; t <= durationMs; t += tickStep) ticks.push(t);

  return (
    <div className="border-t border-border bg-muted/20 p-3" data-keep-selection>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Timeline · {(durationMs / 1000).toFixed(1)}s
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <button
            type="button"
            className="rounded border border-border bg-background px-1.5 py-0.5 hover:bg-accent"
            onClick={() => setZoom((z) => Math.max(0.5, +(z / 1.25).toFixed(2)))}
          >
            −
          </button>
          <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="rounded border border-border bg-background px-1.5 py-0.5 hover:bg-accent"
            onClick={() => setZoom((z) => Math.min(4, +(z * 1.25).toFixed(2)))}
          >
            +
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div ref={trackRef} className="relative" style={{ width: widthPx }}>
          {/* Ruler */}
          <div className="relative h-5 border-b border-border">
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 h-full text-[10px] text-muted-foreground"
                style={{ left: t * pxPerMs }}
              >
                <div className="absolute left-0 top-0 h-2 w-px bg-border" />
                <div className="ml-0.5 mt-1">{fmt(t)}</div>
              </div>
            ))}
          </div>
          {/* Rows */}
          <div className="relative pt-2" style={{ height: Math.max(ROW_HEIGHT + ROW_GAP, ordered.length * (ROW_HEIGHT + ROW_GAP)) }}>
            {ordered.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                Add an element from the right panel — it will appear here as a clip.
              </div>
            )}
            {ordered.map((el, rowIdx) => {
              const isTimeline = el.content.timing_mode === "timeline";
              const start = Math.max(0, el.start_ms ?? 0);
              const end = Math.max(start + MIN_CLIP_MS, el.end_ms ?? durationMs);
              const left = start * pxPerMs;
              const width = Math.max(20, (end - start) * pxPerMs);
              const isSelected = selectedId === el.id;
              return (
                <div
                  key={el.id}
                  className={`absolute rounded-md border text-[11px] shadow-sm select-none ${
                    isSelected
                      ? "border-primary bg-primary/15"
                      : isTimeline
                        ? "border-border bg-card"
                        : "border-dashed border-amber-500/50 bg-amber-500/10"
                  }`}
                  style={{
                    top: rowIdx * (ROW_HEIGHT + ROW_GAP),
                    left,
                    width,
                    height: ROW_HEIGHT,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onSelect(el.id);
                    if (!isTimeline) return;
                    setDrag({
                      id: el.id,
                      mode: "move",
                      originX: e.clientX,
                      startStart: start,
                      startEnd: end,
                    });
                  }}
                  title={
                    isTimeline
                      ? `${clipLabel(el)} · ${fmt(start)} → ${fmt(end)}`
                      : `${clipLabel(el)} · bound to word "${el.content.word ?? ""}" (switch to Timeline mode to edit time)`
                  }
                >
                  {isTimeline && (
                    <div
                      className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-primary/60 hover:bg-primary"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setDrag({
                          id: el.id,
                          mode: "resize-l",
                          originX: e.clientX,
                          startStart: start,
                          startEnd: end,
                        });
                      }}
                    />
                  )}
                  <div className="px-2 pt-1 truncate">{clipLabel(el)}</div>
                  {isTimeline && (
                    <div
                      className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-primary/60 hover:bg-primary"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setDrag({
                          id: el.id,
                          mode: "resize-r",
                          originX: e.clientX,
                          startStart: start,
                          startEnd: end,
                        });
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {selectedId && (() => {
        const sel = ordered.find((e) => e.id === selectedId);
        if (!sel) return null;
        const isTimeline = sel.content.timing_mode === "timeline";
        return (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-semibold">{clipLabel(sel)}</span>
            <label className="flex items-center gap-1">
              Start
              <input
                type="number"
                min={0}
                step={0.1}
                value={(sel.start_ms / 1000).toFixed(1)}
                disabled={!isTimeline}
                onChange={(e) => {
                  const v = Math.max(0, Math.round(parseFloat(e.target.value || "0") * 1000));
                  onChangeTimes(sel.id, v, Math.max(v + MIN_CLIP_MS, sel.end_ms));
                }}
                className="w-16 rounded border border-border bg-background px-1 py-0.5"
              />
              s
            </label>
            <label className="flex items-center gap-1">
              End
              <input
                type="number"
                min={0}
                step={0.1}
                value={(sel.end_ms / 1000).toFixed(1)}
                disabled={!isTimeline}
                onChange={(e) => {
                  const v = Math.max((sel.start_ms ?? 0) + MIN_CLIP_MS, Math.round(parseFloat(e.target.value || "0") * 1000));
                  onChangeTimes(sel.id, sel.start_ms, v);
                }}
                className="w-16 rounded border border-border bg-background px-1 py-0.5"
              />
              s
            </label>
            {!isTimeline && (
              <span className="text-muted-foreground">Element is in word mode — switch this canvas to Timeline mode to edit times.</span>
            )}
          </div>
        );
      })()}
      <span className="sr-only">{sceneId}</span>
    </div>
  );
}
