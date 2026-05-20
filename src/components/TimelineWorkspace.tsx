import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Play, Pause, ZoomIn, ZoomOut, Trash2, Layers, Music, Eye, EyeOff, Lock, Unlock,
  Sparkles, ArrowLeftRight, Wand2,
} from "lucide-react";
import type { AnimationBlockContent } from "@/components/AnimationBlock";
import { TimelineAudioPanel } from "@/components/TimelineAudioPanel";
import type { CanvasAudioState } from "@/components/CanvasAudioEditor";

export type TransitionType =
  | "fade"
  | "dissolve"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "wipe"
  | "zoom"
  | "blur";

export interface ClipTransition {
  type: TransitionType;
  duration_ms: number;
}

const TRANSITION_PRESETS: { type: TransitionType; label: string; desc: string }[] = [
  { type: "fade",        label: "Fade",         desc: "Soft cross-fade between clips" },
  { type: "dissolve",    label: "Dissolve",     desc: "Pixel dissolve blend" },
  { type: "slide-left",  label: "Slide Left",   desc: "Next clip slides in from right" },
  { type: "slide-right", label: "Slide Right",  desc: "Next clip slides in from left" },
  { type: "slide-up",    label: "Slide Up",     desc: "Next clip pushes up" },
  { type: "wipe",        label: "Wipe",         desc: "Linear wipe reveal" },
  { type: "zoom",        label: "Zoom",         desc: "Zoom in to next clip" },
  { type: "blur",        label: "Blur",         desc: "Defocus to next clip" },
];

function transitionKey(fromId: string, toId: string) {
  return `${fromId}__${toId}`;
}

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
  projectId: string;
  durationMs: number;
  voiceUrl?: string | null;
  elements: TimelineElement[];
  selectedId: string | null;
  narration: string;
  wordTimings: { text: string; start_ms: number; end_ms: number }[];
  audioState: CanvasAudioState;
  onSelect: (id: string) => void;
  onChangeTimes: (id: string, start_ms: number, end_ms: number) => void;
  onDelete?: (id: string) => void;
  onPlayheadChange?: (ms: number, playing: boolean) => void;
  onAudioChange: (
    patch: Partial<CanvasAudioState> & {
      narration?: string;
      word_timings?: { text: string; start_ms: number; end_ms: number }[];
    },
  ) => void;
  onWordSearch?: (word: string) => void;
}

const MIN_CLIP_MS = 200;
const SNAP_MS = 250;
const LABEL_WIDTH = 168;
const ROW_HEIGHT = 38;
const ROW_GAP = 4;
const LANE_MIN_ROWS = 2; // always show at least 2 sub-rows so users can drop a 2nd clip alongside

type LaneKey = "elements" | "audio";

const LANES: { key: LaneKey; label: string; icon: typeof Layers; color: string; ring: string }[] = [
  { key: "elements", label: "Elements", icon: Layers, color: "from-amber-500/80 to-orange-600/80", ring: "ring-amber-300/60" },
  { key: "audio",    label: "Audio",    icon: Music,  color: "from-indigo-500/70 to-blue-600/70",  ring: "ring-indigo-300/60" },
];

function laneOf(el: TimelineElement): LaneKey {
  return el.type === "audio" ? "audio" : "elements";
}

function clipLabel(el: TimelineElement) {
  const c = el.content;
  if (c.text) return String(c.text).slice(0, 28);
  if (c.role) return String(c.role);
  if (c.shape_type) return String(c.shape_type).replace(/-/g, " ");
  return c.name || el.type;
}

function fmtTime(ms: number) {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s * 100) % 100);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function snap(ms: number, bypass: boolean) {
  if (bypass) return ms;
  return Math.round(ms / SNAP_MS) * SNAP_MS;
}

// Pack overlapping clips into sub-rows (greedy first-fit). Returns map id -> row index.
function packRows(clips: { id: string; start: number; end: number }[]): {
  rowOf: Record<string, number>;
  rowCount: number;
} {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const rowEnds: number[] = []; // last end for each row
  const rowOf: Record<string, number> = {};
  for (const c of sorted) {
    let placed = -1;
    for (let i = 0; i < rowEnds.length; i++) {
      if (rowEnds[i] <= c.start) { placed = i; break; }
    }
    if (placed === -1) { rowEnds.push(c.end); placed = rowEnds.length - 1; }
    else rowEnds[placed] = c.end;
    rowOf[c.id] = placed;
  }
  return { rowOf, rowCount: rowEnds.length };
}

export function TimelineWorkspace({
  sceneId, projectId, durationMs, voiceUrl, elements, selectedId,
  narration, wordTimings, audioState,
  onSelect, onChangeTimes, onDelete, onPlayheadChange, onAudioChange, onWordSearch,
}: Props) {
  const [pxPerSec, setPxPerSec] = useState(80);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hiddenLanes, setHiddenLanes] = useState<Record<string, boolean>>({});
  const [lockedLanes, setLockedLanes] = useState<Record<string, boolean>>({});
  const [dragOverride, setDragOverride] = useState<{ id: string; start: number; end: number } | null>(null);
  const [transitions, setTransitions] = useState<Record<string, ClipTransition>>({});
  const [selectedTransition, setSelectedTransition] = useState<{ fromId: string; toId: string } | null>(null);
  const [hoverPairId, setHoverPairId] = useState<string | null>(null);
  const transitionsKey = `cm.timeline.transitions.${sceneId}`;

  // Load + persist transitions per scene
  useEffect(() => {
    try {
      const raw = localStorage.getItem(transitionsKey);
      setTransitions(raw ? JSON.parse(raw) : {});
      setSelectedTransition(null);
    } catch { setTransitions({}); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);
  useEffect(() => {
    try { localStorage.setItem(transitionsKey, JSON.stringify(transitions)); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transitions]);
  const lanesRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const startMsRef = useRef<number>(0);

  const playheadCbRef = useRef(onPlayheadChange);
  useEffect(() => { playheadCbRef.current = onPlayheadChange; }, [onPlayheadChange]);
  useEffect(() => { playheadCbRef.current?.(playheadMs, playing); }, [playheadMs, playing]);

  const pxPerMs = pxPerSec / 1000;
  const totalWidth = Math.max(600, durationMs * pxPerMs);

  // Group elements into lanes + compute packed sub-rows (live during drag)
  const lanesData = useMemo(() => {
    const byLane: Record<LaneKey, TimelineElement[]> = { elements: [], audio: [] };
    elements.forEach((e) => byLane[laneOf(e)].push(e));

    const packed: Record<LaneKey, { rowOf: Record<string, number>; rowCount: number }> = {
      elements: { rowOf: {}, rowCount: 0 },
      audio:    { rowOf: {}, rowCount: 0 },
    };
    (Object.keys(byLane) as LaneKey[]).forEach((k) => {
      const inputs = byLane[k].map((el) => {
        const ov = dragOverride && dragOverride.id === el.id ? dragOverride : null;
        const s = ov ? ov.start : Math.max(0, el.start_ms ?? 0);
        const e = ov ? ov.end   : Math.max(s + MIN_CLIP_MS, el.end_ms ?? durationMs);
        return { id: el.id, start: s, end: e };
      });
      if (k === "audio" && voiceUrl) {
        inputs.push({ id: "__voice__", start: 0, end: durationMs });
      }
      packed[k] = packRows(inputs);
    });

    return { byLane, packed };
  }, [elements, voiceUrl, durationMs, dragOverride]);

  // Compute adjacent clip pairs per lane+row for transition handles
  const adjacentPairs = useMemo(() => {
    const out: { laneKey: LaneKey; row: number; fromId: string; toId: string; gapStart: number; gapEnd: number }[] = [];
    (Object.keys(lanesData.byLane) as LaneKey[]).forEach((k) => {
      if (k === "audio") return; // transitions only between visual elements
      const items = lanesData.byLane[k].map((el) => {
        const ov = dragOverride && dragOverride.id === el.id ? dragOverride : null;
        const s = ov ? ov.start : Math.max(0, el.start_ms ?? 0);
        const e = ov ? ov.end   : Math.max(s + MIN_CLIP_MS, el.end_ms ?? durationMs);
        const row = lanesData.packed[k].rowOf[el.id] ?? 0;
        return { id: el.id, start: s, end: e, row };
      });
      // group by row, then sort
      const byRow: Record<number, typeof items> = {};
      items.forEach((it) => { (byRow[it.row] ||= []).push(it); });
      Object.entries(byRow).forEach(([rowStr, arr]) => {
        const row = Number(rowStr);
        const sorted = [...arr].sort((a, b) => a.start - b.start);
        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i], b = sorted[i + 1];
          // include adjacent (gap >= 0) and small overlaps (gap < 0 but > -800ms)
          if (b.start - a.end >= -800) {
            out.push({
              laneKey: k, row,
              fromId: a.id, toId: b.id,
              gapStart: a.end, gapEnd: b.start,
            });
          }
        }
      });
    });
    return out;
  }, [lanesData, dragOverride]);

  const laneHeights = useMemo(() => {
    const h: Record<LaneKey, number> = { elements: 0, audio: 0 };
    (Object.keys(h) as LaneKey[]).forEach((k) => {
      const rows = Math.max(LANE_MIN_ROWS, lanesData.packed[k].rowCount || LANE_MIN_ROWS);
      h[k] = rows * ROW_HEIGHT + (rows + 1) * ROW_GAP;
    });
    return h;
  }, [lanesData]);

  useEffect(() => { setPlayheadMs(0); setPlaying(false); }, [sceneId]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    startedAtRef.current = performance.now();
    startMsRef.current = playheadMs >= durationMs ? 0 : playheadMs;
    if (playheadMs >= durationMs) setPlayheadMs(0);

    if (audioRef.current && voiceUrl) {
      audioRef.current.currentTime = startMsRef.current / 1000;
      audioRef.current.play().catch(() => {});
    }

    const tick = () => {
      const elapsed = performance.now() - startedAtRef.current;
      const next = startMsRef.current + elapsed;
      if (next >= durationMs) {
        setPlayheadMs(durationMs);
        setPlaying(false);
        if (audioRef.current) audioRef.current.pause();
        return;
      }
      setPlayheadMs(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (audioRef.current) audioRef.current.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, durationMs, voiceUrl]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setPxPerSec((z) => Math.max(20, Math.min(400, +(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)).toFixed(1))));
  }, []);

  const [drag, setDrag] = useState<null | {
    id: string; mode: "move" | "l" | "r"; originX: number; startS: number; startE: number;
  }>(null);

  useEffect(() => {
    if (!drag) return;
    let last = { s: drag.startS, e: drag.startE };
    function onMove(ev: MouseEvent) {
      if (!drag) return;
      const dx = ev.clientX - drag.originX;
      const dms = dx / pxPerMs;
      let s = drag.startS, en = drag.startE;
      const len = drag.startE - drag.startS;
      const bypass = ev.altKey;
      if (drag.mode === "move") {
        s = Math.max(0, Math.min(durationMs - len, drag.startS + dms));
        s = snap(s, bypass);
        en = s + len;
      } else if (drag.mode === "l") {
        s = Math.max(0, Math.min(drag.startE - MIN_CLIP_MS, drag.startS + dms));
        s = snap(s, bypass);
      } else {
        en = Math.max(drag.startS + MIN_CLIP_MS, Math.min(durationMs, drag.startE + dms));
        en = snap(en, bypass);
      }
      last = { s: Math.round(s), e: Math.round(en) };
      setDragOverride({ id: drag.id, start: last.s, end: last.e });
    }
    function onUp() {
      if (drag && (last.s !== drag.startS || last.e !== drag.startE)) {
        onChangeTimes(drag.id, last.s, last.e);
      }
      setDragOverride(null);
      setDrag(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, pxPerMs, durationMs, onChangeTimes]);

  const [scrubbing, setScrubbing] = useState(false);
  const scrubFromEvent = useCallback((clientX: number) => {
    const el = lanesRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(totalWidth, clientX - rect.left + el.scrollLeft));
    const ms = Math.max(0, Math.min(durationMs, x / pxPerMs));
    setPlayheadMs(ms);
    if (audioRef.current && voiceUrl) audioRef.current.currentTime = ms / 1000;
  }, [pxPerMs, durationMs, totalWidth, voiceUrl]);

  useEffect(() => {
    if (!scrubbing) return;
    function onMove(e: MouseEvent) { scrubFromEvent(e.clientX); }
    function onUp() { setScrubbing(false); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [scrubbing, scrubFromEvent]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.code === "Space") { e.preventDefault(); setPlaying((p) => !p); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && onDelete) {
        e.preventDefault(); onDelete(selectedId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, onDelete]);

  const ticks: number[] = [];
  const step = pxPerSec >= 120 ? 500 : pxPerSec >= 60 ? 1000 : pxPerSec >= 30 ? 2000 : 5000;
  for (let t = 0; t <= durationMs; t += step) ticks.push(t);

  const selected = elements.find((e) => e.id === selectedId) || null;
  const totalLanesHeight = LANES.reduce((sum, l) => sum + laneHeights[l.key], 0);

  return (
    <div
      className="border-t border-white/5 bg-[#0f1115] text-zinc-200"
      data-keep-selection
      style={{ colorScheme: "dark" }}
    >
      {voiceUrl && <audio ref={audioRef} src={voiceUrl} preload="auto" />}

      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-white/5 bg-white/[0.03] px-3 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/30 transition hover:scale-105"
          title={playing ? "Pause (Space)" : "Play (Space)"}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
        </button>
        <div className="font-mono text-[11px] tabular-nums text-zinc-300">
          <span className="text-white">{fmtTime(playheadMs)}</span>
          <span className="mx-1 text-zinc-500">/</span>
          <span className="text-zinc-400">{fmtTime(durationMs)}</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPxPerSec((z) => Math.max(20, +(z / 1.25).toFixed(1)))}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <input
            type="range" min={20} max={400} step={1}
            value={pxPerSec}
            onChange={(e) => setPxPerSec(parseInt(e.target.value))}
            className="h-1 w-28 cursor-pointer accent-sky-500"
          />
          <button
            type="button"
            onClick={() => setPxPerSec((z) => Math.min(400, +(z * 1.25).toFixed(1)))}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <span className="ml-1 text-[10px] uppercase tracking-wide text-zinc-500">
            {Math.round(pxPerSec)} px/s
          </span>
        </div>
      </div>

      <div className="flex">
        {/* Layers panel */}
        <div className="shrink-0 border-r border-white/5 bg-white/[0.02]" style={{ width: LABEL_WIDTH }}>
          <div className="h-8 border-b border-white/5 px-3 text-[10px] font-semibold uppercase tracking-wider leading-8 text-zinc-500">
            Layers
          </div>
          {LANES.map((g) => {
            const Icon = g.icon;
            const count = lanesData.byLane[g.key].length + (g.key === "audio" && voiceUrl ? 1 : 0);
            const hidden = !!hiddenLanes[g.key];
            const locked = !!lockedLanes[g.key];
            return (
              <div
                key={g.key}
                className="flex items-center gap-2 border-b border-white/5 px-3"
                style={{ height: laneHeights[g.key] }}
              >
                <div className={`flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br ${g.color} text-white shadow-inner`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 truncate text-xs font-medium text-zinc-200">
                  {g.label}
                  <span className="ml-1 text-[10px] text-zinc-500">{count}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setHiddenLanes((s) => ({ ...s, [g.key]: !hidden }))}
                  className="text-zinc-500 hover:text-zinc-200"
                  title={hidden ? "Show" : "Hide"}
                >
                  {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => setLockedLanes((s) => ({ ...s, [g.key]: !locked }))}
                  className="text-zinc-500 hover:text-zinc-200"
                  title={locked ? "Unlock" : "Lock"}
                >
                  {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </button>
              </div>
            );
          })}
        </div>

        {/* Ruler + lanes */}
        <div className="relative flex-1 overflow-x-auto" onWheel={onWheel}>
          <div ref={lanesRef} className="relative" style={{ width: totalWidth }}>
            {/* Ruler */}
            <div
              className="sticky top-0 z-20 h-8 select-none border-b border-white/10 bg-[#0f1115]/95 backdrop-blur"
              onMouseDown={(e) => { setScrubbing(true); scrubFromEvent(e.clientX); }}
              style={{ cursor: "ew-resize" }}
            >
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full" style={{ left: t * pxPerMs }}>
                  <div className="h-2 w-px bg-white/20" />
                  <div className="ml-1 mt-0.5 font-mono text-[10px] text-zinc-500">
                    {fmtTime(t).replace(/^00:/, "")}
                  </div>
                </div>
              ))}
              {ticks.map((t) =>
                [0.25, 0.5, 0.75].map((f) => (
                  <div
                    key={`${t}-${f}`}
                    className="absolute top-0 h-1 w-px bg-white/10"
                    style={{ left: (t + step * f) * pxPerMs }}
                  />
                )),
              )}
            </div>

            {/* Lanes */}
            <div className="relative">
              {LANES.map((g, gi) => {
                const lh = laneHeights[g.key];
                const isLocked = !!lockedLanes[g.key];
                const rows = Math.max(LANE_MIN_ROWS, lanesData.packed[g.key].rowCount || LANE_MIN_ROWS);
                return (
                  <div
                    key={g.key}
                    className="relative border-b border-white/5"
                    style={{ height: lh, background: gi % 2 === 0 ? "rgba(255,255,255,0.012)" : "transparent" }}
                    onMouseDown={(e) => {
                      if (e.target === e.currentTarget) { setScrubbing(true); scrubFromEvent(e.clientX); }
                    }}
                  >
                    {/* sub-row separators */}
                    {Array.from({ length: rows - 1 }).map((_, i) => (
                      <div
                        key={`sep-${i}`}
                        className="pointer-events-none absolute left-0 right-0 h-px bg-white/[0.04]"
                        style={{ top: (i + 1) * (ROW_HEIGHT + ROW_GAP) }}
                      />
                    ))}

                    {/* vertical grid */}
                    {ticks.map((t) => (
                      <div key={t} className="pointer-events-none absolute top-0 h-full w-px bg-white/[0.04]" style={{ left: t * pxPerMs }} />
                    ))}

                    {/* synthetic voice clip in audio lane (read-only) */}
                    {!hiddenLanes[g.key] && g.key === "audio" && voiceUrl && (() => {
                      const row = lanesData.packed.audio.rowOf["__voice__"] ?? 0;
                      const left = 0;
                      const width = Math.max(24, durationMs * pxPerMs);
                      return (
                        <div
                          key="__voice__"
                          className="absolute flex items-center overflow-hidden rounded-lg bg-gradient-to-br from-indigo-500/60 to-blue-600/60 text-white shadow-md opacity-90"
                          style={{
                            left, width,
                            top: ROW_GAP + row * (ROW_HEIGHT + ROW_GAP),
                            height: ROW_HEIGHT,
                          }}
                          title={`Voiceover · 0 → ${fmtTime(durationMs)}`}
                        >
                          {/* waveform-ish bars */}
                          <div className="absolute inset-0 flex items-center gap-[2px] px-2 opacity-50">
                            {Array.from({ length: Math.max(8, Math.floor(width / 6)) }).map((_, i) => {
                              const h = 30 + Math.abs(Math.sin(i * 0.6)) * 60;
                              return <div key={i} className="w-[2px] rounded-full bg-white" style={{ height: `${h}%` }} />;
                            })}
                          </div>
                          <div className="relative z-10 px-2 text-[11px] font-medium drop-shadow">
                            Voiceover
                          </div>
                        </div>
                      );
                    })()}

                    {/* user clips */}
                    {!hiddenLanes[g.key] && lanesData.byLane[g.key].map((el) => {
                      const override = dragOverride && dragOverride.id === el.id ? dragOverride : null;
                      const start = override ? override.start : Math.max(0, el.start_ms ?? 0);
                      const end = override ? override.end : Math.max(start + MIN_CLIP_MS, el.end_ms ?? durationMs);
                      const left = start * pxPerMs;
                      const width = Math.max(24, (end - start) * pxPerMs);
                      const isSel = selectedId === el.id;
                      const row = lanesData.packed[g.key].rowOf[el.id] ?? 0;
                      return (
                        <div
                          key={el.id}
                          className={`group absolute flex cursor-grab items-center overflow-hidden rounded-lg bg-gradient-to-br ${g.color} text-white shadow-md transition-all active:cursor-grabbing ${
                            isSel ? `ring-2 ring-offset-2 ring-offset-[#0f1115] ${g.ring} shadow-lg scale-[1.01]` : "hover:brightness-110 hover:shadow-lg"
                          } ${isLocked ? "cursor-not-allowed opacity-60" : ""}`}
                          style={{
                            left, width,
                            top: ROW_GAP + row * (ROW_HEIGHT + ROW_GAP),
                            height: ROW_HEIGHT,
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            onSelect(el.id);
                            setSelectedTransition(null);
                            if (isLocked) return;
                            setDrag({ id: el.id, mode: "move", originX: e.clientX, startS: start, startE: end });
                          }}
                          title={`${clipLabel(el)} · ${fmtTime(start)} → ${fmtTime(end)}`}
                        >
                          {!isLocked && (
                            <div
                              className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-white/50 hover:bg-white/80"
                              onMouseDown={(e) => {
                                e.stopPropagation(); onSelect(el.id);
                                setDrag({ id: el.id, mode: "l", originX: e.clientX, startS: start, startE: end });
                              }}
                            />
                          )}
                          <div className="px-2 text-[11px] font-medium truncate drop-shadow-sm">
                            {clipLabel(el)}
                          </div>
                          {!isLocked && (
                            <div
                              className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-white/50 hover:bg-white/80"
                              onMouseDown={(e) => {
                                e.stopPropagation(); onSelect(el.id);
                                setDrag({ id: el.id, mode: "r", originX: e.clientX, startS: start, startE: end });
                              }}
                            />
                          )}
                        </div>
                      );
                    })}

                    {/* Transition handles between adjacent clips */}
                    {!hiddenLanes[g.key] && adjacentPairs
                      .filter((p) => p.laneKey === g.key)
                      .map((p) => {
                        const key = transitionKey(p.fromId, p.toId);
                        const existing = transitions[key];
                        const isSelTx = selectedTransition?.fromId === p.fromId && selectedTransition?.toId === p.toId;
                        const isHover = hoverPairId === key;
                        const showIcon = !!existing || isHover || isSelTx;
                        const center = ((p.gapStart + p.gapEnd) / 2) * pxPerMs;
                        const top = ROW_GAP + p.row * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2;
                        return (
                          <div
                            key={`tx-${key}`}
                            className="absolute z-10"
                            style={{ left: center - 18, top: top - 18, width: 36, height: 36 }}
                            onMouseEnter={() => setHoverPairId(key)}
                            onMouseLeave={() => setHoverPairId((h) => (h === key ? null : h))}
                          >
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTransition({ fromId: p.fromId, toId: p.toId });
                              }}
                              title={existing ? `Transition: ${existing.type}` : "Add transition"}
                              className={`flex h-9 w-9 items-center justify-center rounded-full border text-white shadow-lg transition-all ${
                                showIcon ? "opacity-100 scale-100" : "opacity-0 scale-75 pointer-events-none"
                              } ${
                                isSelTx
                                  ? "border-fuchsia-300 bg-gradient-to-br from-fuchsia-500 to-purple-600 ring-2 ring-fuchsia-300/60"
                                  : existing
                                  ? "border-fuchsia-300/60 bg-gradient-to-br from-fuchsia-500/90 to-purple-600/90 hover:scale-110"
                                  : "border-white/30 bg-zinc-900/80 backdrop-blur hover:bg-fuchsia-600/80 hover:border-fuchsia-300/60 hover:scale-110"
                              }`}
                            >
                              {existing ? <Sparkles className="h-4 w-4" /> : <ArrowLeftRight className="h-4 w-4" />}
                            </button>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>

            {/* Playhead */}
            <div
              className="pointer-events-none absolute top-0 z-10 flex flex-col items-center"
              style={{ left: playheadMs * pxPerMs, height: 32 + totalLanesHeight }}
            >
              <div className="-mt-1 h-3 w-3 rotate-45 rounded-sm bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]" />
              <div className="w-px flex-1 bg-red-500/90 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
            </div>
          </div>
        </div>

        {/* Inspector */}
        <div
          className="flex shrink-0 flex-col border-l border-white/5 bg-white/[0.02]"
          style={{ width: 320, height: 32 + totalLanesHeight, minHeight: 360 }}
        >
          <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {selectedTransition ? "Transition" : "Properties"}
            </span>
            {selectedTransition && (
              <button
                type="button"
                onClick={() => setSelectedTransition(null)}
                className="text-[10px] text-zinc-400 hover:text-white"
              >
                Close
              </button>
            )}
          </div>

          {selectedTransition ? (
            <TransitionInspector
              fromLabel={clipLabel(elements.find((e) => e.id === selectedTransition.fromId) || ({} as TimelineElement))}
              toLabel={clipLabel(elements.find((e) => e.id === selectedTransition.toId) || ({} as TimelineElement))}
              current={transitions[transitionKey(selectedTransition.fromId, selectedTransition.toId)] || null}
              onSet={(t) =>
                setTransitions((prev) => ({
                  ...prev,
                  [transitionKey(selectedTransition.fromId, selectedTransition.toId)]: t,
                }))
              }
              onRemove={() =>
                setTransitions((prev) => {
                  const next = { ...prev };
                  delete next[transitionKey(selectedTransition.fromId, selectedTransition.toId)];
                  return next;
                })
              }
            />
          ) : (
            <>
              {/* 20% — delete only */}
              <div
                className="flex shrink-0 items-center border-b border-white/5 px-3"
                style={{ flexBasis: "20%" }}
              >
                {selected ? (
                  <button
                    type="button"
                    onClick={() => onDelete?.(selected.id)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300 hover:bg-red-500/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete clip
                  </button>
                ) : (
                  <p className="w-full text-center text-[11px] text-zinc-500">
                    Select a clip to delete
                  </p>
                )}
              </div>
              {/* 80% — audio + transcript */}
              <div className="min-h-0 flex-1 p-3" style={{ flexBasis: "80%" }}>
                <TimelineAudioPanel
                  sceneId={sceneId}
                  projectId={projectId}
                  state={audioState}
                  narration={narration}
                  wordTimings={wordTimings}
                  onChange={onAudioChange}
                  onWordSearch={onWordSearch}
                />
              </div>
            </>
          )}
        </div>
      </div>


      <div className="flex items-center gap-3 border-t border-white/5 bg-white/[0.02] px-3 py-1.5 text-[10px] text-zinc-500">
        <span>⌥ Alt-drag: bypass snap</span>
        <span>⌘/Ctrl + wheel: zoom</span>
        <span>Space: play/pause</span>
        <span>Del: remove clip</span>
        <span className="ml-auto opacity-60">scene {sceneId.slice(0, 8)}</span>
      </div>
    </div>
  );
}

function InspectorPanel({
  element, durationMs, onDelete,
}: {
  element: TimelineElement;
  durationMs: number;
  onDelete?: (id: string) => void;
}) {
  const start = element.start_ms ?? 0;
  const end = element.end_ms ?? durationMs;
  const dur = Math.max(MIN_CLIP_MS, end - start);

  return (
    <div className="space-y-3 text-[11px]">
      <div className="truncate font-medium text-zinc-200" title={element.type}>
        {(element.content.text as string) || element.content.role || element.content.shape_type || element.content.name || element.type}
      </div>

      <div className="rounded-md border border-white/10 bg-white/[0.03] p-2 font-mono text-[11px] text-zinc-300">
        <div className="flex justify-between"><span className="text-zinc-500">Start</span><span>{(start / 1000).toFixed(2)}s</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">Duration</span><span>{(dur / 1000).toFixed(2)}s</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">End</span><span>{(end / 1000).toFixed(2)}s</span></div>
      </div>

      <p className="text-[10px] leading-relaxed text-zinc-500">
        Drag the clip on the timeline to move it. Drag its edges to resize. Hold ⌥ Alt to bypass snapping. Overlapping clips stack into sub-rows automatically.
      </p>

      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(element.id)}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300 hover:bg-red-500/20"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete clip
        </button>
      )}
    </div>
  );
}

function TransitionInspector({
  fromLabel, toLabel, current, onSet, onRemove,
}: {
  fromLabel: string;
  toLabel: string;
  current: ClipTransition | null;
  onSet: (t: ClipTransition) => void;
  onRemove: () => void;
}) {
  const [duration, setDuration] = useState<number>(current?.duration_ms ?? 500);

  useEffect(() => {
    if (current) setDuration(current.duration_ms);
  }, [current?.type]);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-3 flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] text-zinc-300">
        <span className="truncate">{fromLabel || "Clip A"}</span>
        <ArrowLeftRight className="h-3 w-3 shrink-0 text-fuchsia-400" />
        <span className="truncate">{toLabel || "Clip B"}</span>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Style</span>
        {current && (
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/20"
          >
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto pr-1">
        {TRANSITION_PRESETS.map((p) => {
          const active = current?.type === p.type;
          return (
            <button
              key={p.type}
              type="button"
              onClick={() => onSet({ type: p.type, duration_ms: duration })}
              className={`group flex flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left transition-all ${
                active
                  ? "border-fuchsia-300/70 bg-gradient-to-br from-fuchsia-500/20 to-purple-600/20 ring-1 ring-fuchsia-300/50"
                  : "border-white/10 bg-white/[0.03] hover:border-fuchsia-300/40 hover:bg-white/[0.06]"
              }`}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-100">
                <Wand2 className={`h-3 w-3 ${active ? "text-fuchsia-300" : "text-zinc-400 group-hover:text-fuchsia-300"}`} />
                {p.label}
              </div>
              <div className="text-[9px] leading-snug text-zinc-500">{p.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-3 border-t border-white/5 pt-2">
        <label className="flex items-center justify-between text-[10px] text-zinc-400">
          <span>Duration</span>
          <span className="font-mono text-zinc-200">{(duration / 1000).toFixed(2)}s</span>
        </label>
        <input
          type="range"
          min={100}
          max={2000}
          step={50}
          value={duration}
          onChange={(e) => {
            const d = parseInt(e.target.value);
            setDuration(d);
            if (current) onSet({ type: current.type, duration_ms: d });
          }}
          className="mt-1 h-1 w-full cursor-pointer accent-fuchsia-500"
        />
      </div>
    </div>
  );
}
