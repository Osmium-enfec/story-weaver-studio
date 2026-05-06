import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AnimationBlockRenderer, type AnimationBlockContent } from "@/components/AnimationBlock";
import { BackgroundLayer, type SceneBackground } from "@/components/BackgroundPicker";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export interface PlaybackElement {
  id: string;
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

      // Build word→elements map for this scene, tracking occurrence
      const occurrenceCounter: Record<string, number> = {};
      const wordMap = new Map<string, string[]>(); // key: word|occurrence -> element ids
      const unboundIds: string[] = [];
      for (const el of scene.elements) {
        const w = el.content.word ? normalize(el.content.word) : "";
        if (!w) {
          unboundIds.push(el.id);
          continue;
        }
        const occ = el.content.occurrence ?? 1;
        const key = `${w}|${occ}`;
        const arr = wordMap.get(key) ?? [];
        arr.push(el.id);
        wordMap.set(key, arr);
      }

      // Start with unbound elements visible immediately
      setRevealedIds(new Set(unboundIds));

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
        const startMs = scene.voice_start_ms ?? 0;
        const endMs = scene.voice_end_ms ?? startMs;
        const sceneDur = Math.max(500, endMs - startMs);

        // Schedule word-based reveals using word_timings (relative to scene start)
        const timings = scene.word_timings ?? [];
        for (const wt of timings) {
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
          }, Math.max(0, wt.start_ms));
          timersRef.current.push(t);
        }

        // Play the audio segment
        const audio = new Audio(scene.voice_url!);
        audioRef.current = audio;
        audio.currentTime = startMs / 1000;
        audio.play().catch(() => {
          /* autoplay rejection: still advance via timer */
        });

        const stopTimer = setTimeout(() => {
          try {
            audio.pause();
          } catch {
            /* ignore */
          }
          finish();
        }, sceneDur);
        timersRef.current.push(stopTimer);
        return;
      }

      // ─── Path B: TTS or stagger fallback ─────────────────────────────────
      const narration = (scene.narration ?? "").trim();
      const hasSpeech = narration.length > 0 && "speechSynthesis" in window;

      if (!hasSpeech) {
        // Stagger reveals over fallback duration
        const ids = scene.elements.map((e) => e.id);
        ids.forEach((id, i) => {
          const t = setTimeout(() => {
            if (cancelRef.current) return;
            setRevealedIds((prev) => new Set(prev).add(id));
          }, ((i + 1) / (ids.length + 1)) * FALLBACK_SCENE_MS);
          timersRef.current.push(t);
        });
        const t = setTimeout(finish, Math.max(MIN_REVEAL_MS, FALLBACK_SCENE_MS));
        timersRef.current.push(t);
        return;
      }

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
                    <AnimationBlockRenderer content={el.content} />
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
