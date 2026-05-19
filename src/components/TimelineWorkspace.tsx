import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Play, Pause, ZoomIn, ZoomOut, Trash2, Type, Shapes, Sparkles,
  Image as ImageIcon, Video as VideoIcon, Music, Eye, EyeOff, Lock, Unlock,
} from "lucide-react";
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
  voiceUrl?: string | null;
  elements: TimelineElement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChangeTimes: (id: string, start_ms: number, end_ms: number) => void;
  onDelete?: (id: string) => void;
}

const MIN_CLIP_MS = 200;
const SNAP_MS = 250;
const LABEL_WIDTH = 168;
const TRACK_HEIGHT = 44;

type GroupKey = "text" | "shape" | "anim" | "image" | "video" | "audio";

const GROUPS: { key: GroupKey; label: string; icon: typeof Type; color: string; ring: string }[] = [
  { key: "text",  label: "Text",       icon: Type,       color: "from-sky-500/70 to-sky-600/70",      ring: "ring-sky-300/60" },
  { key: "shape", label: "Shapes",     icon: Shapes,     color: "from-violet-500/70 to-fuchsia-600/70", ring: "ring-violet-300/60" },
  { key: "anim",  label: "Animations", icon: Sparkles,   color: "from-amber-500/80 to-orange-600/80",  ring: "ring-amber-300/60" },
  { key: "image", label: "Images",     icon: ImageIcon,  color: "from-pink-500/70 to-rose-600/70",     ring: "ring-pink-300/60" },
  { key: "video", label: "Video",      icon: VideoIcon,  color: "from-emerald-500/70 to-teal-600/70",  ring: "ring-emerald-300/60" },
  { key: "audio", label: "Audio",      icon: Music,      color: "from-indigo-500/70 to-blue-600/70",   ring: "ring-indigo-300/60" },
];

function groupOf(el: TimelineElement): GroupKey {
  const t = el.type;
  if (t === "text") return "text";
  if (t === "shape") return "shape";
  if (t === "image") return "image";
  if (t === "video") return "video";
  if (t === "audio") return "audio";
  return "anim";
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

export function TimelineWorkspace({
  sceneId, durationMs, voiceUrl, elements, selectedId,
  onSelect, onChangeTimes, onDelete,
}: Props) {
  const [pxPerSec, setPxPerSec] = useState(80);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hiddenGroups, setHiddenGroups] = useState<Record<string, boolean>>({});
  const [lockedGroups, setLockedGroups] = useState<Record<string, boolean>>({});
  const lanesRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const startMsRef = useRef<number>(0);

  const pxPerMs = pxPerSec / 1000;
  const totalWidth = Math.max(600, durationMs * pxPerMs);

  const grouped = useMemo(() => {
    const map: Record<GroupKey, TimelineElement[]> = {
      text: [], shape: [], anim: [], image: [], video: [], audio: [],
    };
    elements.forEach((e) => map[groupOf(e)].push(e));
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.start_ms - b.start_ms));
    return map;
  }, [elements]);

  // Reset playhead when scene changes
  useEffect(() => { setPlayheadMs(0); setPlaying(false); }, [sceneId]);

  // Playback loop
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

  // Ctrl/Cmd+wheel zoom
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setPxPerSec((z) => Math.max(20, Math.min(400, +(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)).toFixed(1))));
  }, []);

  // Drag clip (move / resize)
  const [drag, setDrag] = useState<null | {
    id: string; mode: "move" | "l" | "r"; originX: number; startS: number; startE: number;
  }>(null);

  useEffect(() => {
    if (!drag) return;
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
      onChangeTimes(drag.id, Math.round(s), Math.round(en));
    }
    function onUp() { setDrag(null); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, pxPerMs, durationMs, onChangeTimes]);

  // Scrub playhead via ruler / lanes background
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

  // Keyboard: space play/pause, delete remove
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

  // Ruler ticks
  const ticks: number[] = [];
  const step = pxPerSec >= 120 ? 500 : pxPerSec >= 60 ? 1000 : pxPerSec >= 30 ? 2000 : 5000;
  for (let t = 0; t <= durationMs; t += step) ticks.push(t);

  const selected = elements.find((e) => e.id === selectedId) || null;

  return (
    <div
      className="border-t border-white/5 bg-[#0f1115] text-zinc-200"
      data-keep-selection
      style={{ colorScheme: "dark" }}
    >
      {/* Hidden audio for real-time playback */}
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

      {/* Body */}
      <div className="flex">
        {/* Left: layers panel */}
        <div className="shrink-0 border-r border-white/5 bg-white/[0.02]" style={{ width: LABEL_WIDTH }}>
          <div className="h-8 border-b border-white/5 px-3 text-[10px] font-semibold uppercase tracking-wider leading-8 text-zinc-500">
            Layers
          </div>
          {GROUPS.map((g) => {
            const Icon = g.icon;
            const count = grouped[g.key].length;
            const hidden = !!hiddenGroups[g.key];
            const locked = !!lockedGroups[g.key];
            return (
              <div
                key={g.key}
                className="flex items-center gap-2 border-b border-white/5 px-3"
                style={{ height: TRACK_HEIGHT }}
              >
                <div className={`flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br ${g.color} text-white shadow-inner`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 truncate text-xs font-medium text-zinc-200">
                  {g.label}
                  <span className="ml-1 text-[10px] text-zinc-500">{count}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setHiddenGroups((s) => ({ ...s, [g.key]: !hidden }))}
                  className="text-zinc-500 hover:text-zinc-200"
                  title={hidden ? "Show" : "Hide"}
                >
                  {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => setLockedGroups((s) => ({ ...s, [g.key]: !locked }))}
                  className="text-zinc-500 hover:text-zinc-200"
                  title={locked ? "Unlock" : "Lock"}
                >
                  {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </button>
              </div>
            );
          })}
        </div>

        {/* Right: ruler + lanes */}
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
              {/* sub ticks */}
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

            {/* Lanes background grid */}
            <div className="relative">
              {GROUPS.map((g, gi) => (
                <div
                  key={g.key}
                  className="relative border-b border-white/5"
                  style={{ height: TRACK_HEIGHT, background: gi % 2 === 0 ? "rgba(255,255,255,0.012)" : "transparent" }}
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget) { setScrubbing(true); scrubFromEvent(e.clientX); }
                  }}
                >
                  {/* Vertical grid lines */}
                  {ticks.map((t) => (
                    <div key={t} className="pointer-events-none absolute top-0 h-full w-px bg-white/[0.04]" style={{ left: t * pxPerMs }} />
                  ))}

                  {/* Clips */}
                  {!hiddenGroups[g.key] && grouped[g.key].map((el) => {
                    const start = Math.max(0, el.start_ms ?? 0);
                    const end = Math.max(start + MIN_CLIP_MS, el.end_ms ?? durationMs);
                    const left = start * pxPerMs;
                    const width = Math.max(24, (end - start) * pxPerMs);
                    const isSel = selectedId === el.id;
                    const isLocked = !!lockedGroups[g.key];
                    return (
                      <div
                        key={el.id}
                        className={`group absolute top-1 flex h-[34px] cursor-grab items-center overflow-hidden rounded-lg bg-gradient-to-br ${g.color} text-white shadow-md transition-all active:cursor-grabbing ${
                          isSel ? `ring-2 ring-offset-2 ring-offset-[#0f1115] ${g.ring} shadow-lg scale-[1.01]` : "hover:brightness-110 hover:shadow-lg"
                        } ${isLocked ? "cursor-not-allowed opacity-60" : ""}`}
                        style={{ left, width }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          onSelect(el.id);
                          if (isLocked) return;
                          setDrag({ id: el.id, mode: "move", originX: e.clientX, startS: start, startE: end });
                        }}
                        title={`${clipLabel(el)} · ${fmtTime(start)} → ${fmtTime(end)}`}
                      >
                        {/* left handle */}
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
                        {/* right handle */}
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
                </div>
              ))}
            </div>

            {/* Playhead (spans ruler + lanes) */}
            <div
              className="pointer-events-none absolute top-0 z-10 flex flex-col items-center"
              style={{ left: playheadMs * pxPerMs, height: 8 * 1 + GROUPS.length * TRACK_HEIGHT + 32 }}
            >
              <div className="-mt-1 h-3 w-3 rotate-45 rounded-sm bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]" />
              <div className="w-px flex-1 bg-red-500/90 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
            </div>
          </div>
        </div>

        {/* Right: inspector */}
        <div className="shrink-0 border-l border-white/5 bg-white/[0.02] p-3" style={{ width: 220 }}>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Properties
          </div>
          {!selected ? (
            <div className="rounded-md border border-dashed border-white/10 p-3 text-[11px] text-zinc-500">
              Select a clip to edit its timing.
            </div>
          ) : (
            <InspectorPanel
              key={selected.id}
              element={selected}
              durationMs={durationMs}
              onChangeTimes={onChangeTimes}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>

      {/* hint footer */}
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
  element, durationMs, onChangeTimes, onDelete,
}: {
  element: TimelineElement;
  durationMs: number;
  onChangeTimes: (id: string, s: number, e: number) => void;
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
        Drag the clip on the timeline to move it. Drag its edges to resize. Hold ⌥ Alt to bypass snapping.
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

function Field({
  label, value, max, disabled, onChange,
}: {
  label: string; value: number; max: number; disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-zinc-400">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-zinc-300">{(value / 1000).toFixed(2)}s</span>
      </div>
      <input
        type="range" min={0} max={Math.max(max, 100)} step={50}
        value={Math.min(value, max)}
        disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="h-1 w-full cursor-pointer accent-sky-500 disabled:opacity-40"
      />
    </div>
  );
}
