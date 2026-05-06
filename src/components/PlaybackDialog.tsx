import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AnimationBlockRenderer, TextBlockRenderer, type AnimationBlockContent } from "@/components/AnimationBlock";
import { BackgroundLayer, type SceneBackground } from "@/components/BackgroundPicker";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export interface PlaybackElement {
  id: string;
  type?: string;
  content: AnimationBlockContent;
  position: { x: number; y: number; w: number; h: number };
  z_index: number;
}

export interface WordTiming {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface PlaybackScene {
  id: string;
  background: SceneBackground;
  elements: PlaybackElement[];
  narration?: string;
  voice_url?: string | null;
  voice_start_ms?: number | null;
  voice_end_ms?: number | null;
  word_timings?: WordTiming[];
  voice_trim_start_ms?: number;
  voice_trim_end_ms?: number | null;
  voice_cuts?: { start_ms: number; end_ms: number }[];
  voice_volume?: number;
  voice_fade_in_ms?: number;
  voice_fade_out_ms?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  script?: string;
  scenes: PlaybackScene[];
  canvasSize: { w: number; h: number };
}

const FALLBACK_SCENE_MS = 3500;
const TRANSITION_MS = 600;
const MIN_REVEAL_MS = 1200;

function normalize(w: string) {
  return w.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export function PlaybackDialog({ open, onOpenChange, scenes, canvasSize }: Props) {
  const [playing, setPlaying] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const stageRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [scale, setScale] = useState(1);
  const cancelRef = useRef(false);

  function clearTimers() {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }

  useEffect(() => {
    if (!open) {
      window.speechSynthesis?.cancel();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      clearTimers();
      cancelRef.current = true;
      setPlaying(false);
      setCurrentIdx(0);
      setTransitioning(false);
      setRevealedIds(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function update() {
      const node = stageRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const s = Math.min(rect.width / canvasSize.w, rect.height / canvasSize.h);
      setScale(s || 1);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, canvasSize.w, canvasSize.h]);

  function playScene(idx: number): Promise<void> {
    return new Promise((resolve) => {
      if (cancelRef.current) return resolve();
      const scene = scenes[idx];
      if (!scene) return resolve();
      setCurrentIdx(idx);
      clearTimers();

      // Build word→elements map for this scene, tracking occurrence.
      // Sequence order = scene.elements order (already z_index-sorted upstream).
      const occurrenceCounter: Record<string, number> = {};
      const wordMap = new Map<string, string[]>();
      const unboundIdsBySeq: string[] = [];
      for (const el of scene.elements) {
        const w = el.content.word ? normalize(el.content.word) : "";
        if (!w) {
          unboundIdsBySeq.push(el.id);
          continue;
        }
        const occ = el.content.occurrence ?? 1;
        const key = `${w}|${occ}`;
        const arr = wordMap.get(key) ?? [];
        arr.push(el.id);
        wordMap.set(key, arr);
      }

      // Nothing visible at start; reveals are scheduled below.
      setRevealedIds(new Set());

      // Schedule unbound elements evenly across `totalMs` in sequence order.
      const scheduleUnbound = (totalMs: number) => {
        if (unboundIdsBySeq.length === 0) return;
        unboundIdsBySeq.forEach((id, i) => {
          const at = ((i + 1) / (unboundIdsBySeq.length + 1)) * totalMs;
          const t = setTimeout(() => {
            if (cancelRef.current) return;
            setRevealedIds((prev) => new Set(prev).add(id));
          }, Math.max(0, at));
          timersRef.current.push(t);
        });
      };

      const finish = () => {
        if (cancelRef.current) return resolve();
        clearTimers();
        // Reveal everything at the end before transitioning
        setRevealedIds(new Set(scene.elements.map((e) => e.id)));
        setTimeout(() => {
          if (cancelRef.current) return resolve();
          if (idx + 1 < scenes.length) {
            setTransitioning(true);
            setTimeout(() => {
              setTransitioning(false);
              playScene(idx + 1).then(resolve);
            }, TRANSITION_MS);
          } else {
            resolve();
          }
        }, 400);
      };

      // ─── Path A: real voice with word timings ────────────────────────────
      const hasVoice =
        !!scene.voice_url &&
        scene.voice_start_ms != null &&
        scene.voice_end_ms != null;

      if (hasVoice) {
        const segStart = scene.voice_start_ms ?? 0;
        const segEnd = scene.voice_end_ms ?? segStart;
        const trimStart = Math.max(0, scene.voice_trim_start_ms ?? 0);
        const trimEnd = scene.voice_trim_end_ms ?? (segEnd - segStart);
        const volume = scene.voice_volume ?? 1;
        const fadeIn = (scene.voice_fade_in_ms ?? 0) / 1000;
        const fadeOut = (scene.voice_fade_out_ms ?? 0) / 1000;
        const cuts = (scene.voice_cuts ?? []).filter((c) => c.end_ms > trimStart && c.start_ms < trimEnd);

        // Build playback ranges (segment-relative ms) honoring trim + cuts
        const ranges: { start: number; end: number }[] = [];
        let cursor = trimStart;
        for (const c of cuts.sort((a, b) => a.start_ms - b.start_ms)) {
          const a = Math.max(c.start_ms, trimStart);
          const b = Math.min(c.end_ms, trimEnd);
          if (a > cursor) ranges.push({ start: cursor, end: a });
          cursor = Math.max(cursor, b);
        }
        if (cursor < trimEnd) ranges.push({ start: cursor, end: trimEnd });

        const totalAudibleMs = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
        scheduleUnbound(totalAudibleMs);

        // Schedule word-based reveals using AUDIBLE elapsed time
        // (skip words inside cuts; squeeze remaining timeline)
        const timings = scene.word_timings ?? [];
        for (const wt of timings) {
          if (wt.start_ms < trimStart || wt.end_ms > trimEnd) continue;
          // Skip words inside any cut
          if (cuts.some((c) => wt.start_ms >= c.start_ms && wt.end_ms <= c.end_ms)) continue;
          // Compute audible elapsed at wt.start_ms
          let elapsed = 0;
          for (const r of ranges) {
            if (wt.start_ms >= r.end) {
              elapsed += r.end - r.start;
            } else if (wt.start_ms >= r.start) {
              elapsed += wt.start_ms - r.start;
              break;
            } else break;
          }
          const word = normalize(wt.text);
          if (!word) continue;
          const t = setTimeout(() => {
            if (cancelRef.current) return;
            occurrenceCounter[word] = (occurrenceCounter[word] ?? 0) + 1;
            const occ = occurrenceCounter[word];
            const ids =
              wordMap.get(`${word}|${occ}`) ?? wordMap.get(`${word}|1`) ?? [];
            if (ids.length === 0) return;
            setRevealedIds((prev) => {
              const next = new Set(prev);
              ids.forEach((id) => next.add(id));
              return next;
            });
          }, Math.max(0, elapsed));
          timersRef.current.push(t);
        }

        // Audio element + WebAudio gain for volume/fades
        const audio = new Audio(scene.voice_url!);
        audio.crossOrigin = "anonymous";
        audioRef.current = audio;

        let AC: AudioContext | null = null;
        let gain: GainNode | null = null;
        try {
          const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
          AC = new Ctx();
          const src = AC.createMediaElementSource(audio);
          gain = AC.createGain();
          gain.gain.value = volume;
          src.connect(gain).connect(AC.destination);
        } catch {
          audio.volume = Math.min(1, Math.max(0, volume));
        }

        // Play through ranges sequentially. Whisper times are already
        // segment-relative (start_ms is ~0). Audio file is the canvas's clip
        // OR a master file — handle both: if voice_start_ms > 0, the audio is
        // the master file and we offset accordingly.
        const fileOffsetSec = (segStart) / 1000;
        let rangeIdx = 0;
        let stopped = false;

        const playRange = () => {
          if (stopped || cancelRef.current) return;
          const r = ranges[rangeIdx];
          if (!r) {
            try { audio.pause(); } catch { /* */ }
            try { void AC?.close(); } catch { /* */ }
            finish();
            return;
          }
          audio.currentTime = fileOffsetSec + r.start / 1000;
          const dur = (r.end - r.start) / 1000;
          // Fades: only on first/last range
          if (gain && AC) {
            const now = AC.currentTime;
            gain.gain.cancelScheduledValues(now);
            if (rangeIdx === 0 && fadeIn > 0) {
              gain.gain.setValueAtTime(0, now);
              gain.gain.linearRampToValueAtTime(volume, now + Math.min(fadeIn, dur));
            } else {
              gain.gain.setValueAtTime(volume, now);
            }
            if (rangeIdx === ranges.length - 1 && fadeOut > 0) {
              gain.gain.setValueAtTime(volume, now + Math.max(0, dur - fadeOut));
              gain.gain.linearRampToValueAtTime(0, now + dur);
            }
          }
          audio.play().catch(() => { /* autoplay rejection */ });
          const t = setTimeout(() => {
            rangeIdx += 1;
            playRange();
          }, dur * 1000);
          timersRef.current.push(t);
        };

        // Safety stop after total audible duration
        const guard = setTimeout(() => {
          stopped = true;
          try { audio.pause(); } catch { /* */ }
          try { void AC?.close(); } catch { /* */ }
        }, totalAudibleMs + 500);
        timersRef.current.push(guard);

        playRange();
        return;
      }

      // ─── Path B: TTS or stagger fallback ─────────────────────────────────
      const narration = (scene.narration ?? "").trim();
      const hasSpeech = narration.length > 0 && "speechSynthesis" in window;

      if (!hasSpeech) {
        scheduleUnbound(FALLBACK_SCENE_MS);
        const t = setTimeout(finish, Math.max(MIN_REVEAL_MS, FALLBACK_SCENE_MS));
        timersRef.current.push(t);
        return;
      }

      // Estimate narration duration to distribute unbound elements
      const estimatedMs = Math.max(MIN_REVEAL_MS, narration.length * 60);
      scheduleUnbound(estimatedMs);

      const u = new SpeechSynthesisUtterance(narration);
      u.rate = 1;
      u.onboundary = (ev: SpeechSynthesisEvent) => {
        if (ev.name && ev.name !== "word") return;
        const tail = narration.slice(ev.charIndex);
        const m = tail.match(/[A-Za-z][A-Za-z0-9_-]*/);
        if (!m) return;
        const word = normalize(m[0]);
        occurrenceCounter[word] = (occurrenceCounter[word] ?? 0) + 1;
        const occ = occurrenceCounter[word];
        const ids = wordMap.get(`${word}|${occ}`) ?? wordMap.get(`${word}|1`) ?? [];
        if (ids.length === 0) return;
        setRevealedIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.add(id));
          return next;
        });
      };
      u.onend = finish;
      u.onerror = finish;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    });
  }

  function start() {
    if (scenes.length === 0) return toast.error("Add a canvas first");
    cancelRef.current = false;
    setPlaying(true);
    setCurrentIdx(0);
    setRevealedIds(new Set());
    playScene(0).then(() => {
      setPlaying(false);
    });
  }

  function stop() {
    cancelRef.current = true;
    window.speechSynthesis?.cancel();
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        /* ignore */
      }
      audioRef.current = null;
    }
    clearTimers();
    setPlaying(false);
    setTransitioning(false);
  }

  const current = scenes[currentIdx];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogTitle className="sr-only">Preview</DialogTitle>
        <div className="flex flex-col gap-3">
          <div
            ref={stageRef}
            className="relative flex items-center justify-center bg-muted/30 rounded-lg overflow-hidden"
            style={{ height: "60vh" }}
          >
            <div
              key={current?.id}
              className={`relative bg-white shadow-md rounded-xl overflow-hidden transition-opacity duration-500 ${
                transitioning ? "opacity-0" : "opacity-100 animate-fade-in"
              }`}
              style={{
                width: canvasSize.w,
                height: canvasSize.h,
                transform: `scale(${scale})`,
                transformOrigin: "center center",
              }}
            >
              {current && <BackgroundLayer background={current.background} />}
              {current?.elements.map((el) => {
                const visible = revealedIds.has(el.id);
                const isText = el.type === "text" || typeof el.content.text === "string" || !!el.content.role;
                return (
                  <div
                    key={el.id}
                    style={{
                      position: "absolute",
                      left: el.position.x,
                      top: el.position.y,
                      width: el.position.w,
                      height: el.position.h,
                      zIndex: el.z_index,
                      opacity: visible ? 1 : 0,
                      transform: visible ? "scale(1)" : "scale(0.92)",
                      transition: "opacity 350ms ease, transform 350ms ease",
                    }}
                  >
                    {isText ? (
                      <TextBlockRenderer content={el.content} />
                    ) : (
                      <AnimationBlockRenderer content={el.content} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Canvas {Math.min(currentIdx + 1, scenes.length)} / {scenes.length}
            </span>
            {playing ? (
              <Button variant="secondary" onClick={stop}>Stop</Button>
            ) : (
              <Button onClick={start}>Play</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
