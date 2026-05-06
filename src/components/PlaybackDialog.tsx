import { useEffect, useMemo, useRef, useState } from "react";
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

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  script: string;
  elements: PlaybackElement[];
  /** Original canvas pixel size when elements were placed */
  canvasSize: { w: number; h: number };
  background?: SceneBackground;
}

const WORD_RE = /[A-Za-z][A-Za-z0-9_-]*/g;

export function PlaybackDialog({ open, onOpenChange, script, elements, canvasSize, background }: Props) {
  const wordIndexById = useMemo(() => {
    const map = new Map<string, number>();
    if (!script) return map;
    const tokens: string[] = [];
    for (const m of script.matchAll(WORD_RE)) tokens.push(m[0].toLowerCase());
    for (const el of elements) {
      const w = el.content.word?.toLowerCase();
      if (!w) continue;
      const occ = el.content.occurrence ?? 1;
      let seen = 0;
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === w) {
          seen++;
          if (seen === occ) {
            map.set(el.id, i);
            break;
          }
        }
      }
    }
    return map;
  }, [script, elements]);

  const [revealedWordIdx, setRevealedWordIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!open) {
      window.speechSynthesis?.cancel();
      setPlaying(false);
      setRevealedWordIdx(-1);
    }
  }, [open]);

  // Compute scale so the original canvas fits the dialog stage
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

  function start() {
    if (!script.trim()) return toast.error("Add a script first");
    if (!("speechSynthesis" in window)) return toast.error("Browser TTS not supported");
    setRevealedWordIdx(-1);
    const u = new SpeechSynthesisUtterance(script);
    u.rate = 1;
    u.onboundary = (e: SpeechSynthesisEvent) => {
      if (e.name !== "word") return;
      const upto = script.slice(0, e.charIndex);
      const count = (upto.match(WORD_RE) || []).length;
      setRevealedWordIdx(count);
    };
    u.onend = () => {
      setPlaying(false);
      setRevealedWordIdx(Number.MAX_SAFE_INTEGER);
    };
    u.onerror = () => setPlaying(false);
    utterRef.current = u;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setPlaying(true);
  }

  function stop() {
    window.speechSynthesis?.cancel();
    setPlaying(false);
  }

  const visibleIds = new Set(
    elements
      .filter((el) => {
        const wIdx = wordIndexById.get(el.id);
        if (wIdx === undefined) return true;
        return wIdx <= revealedWordIdx;
      })
      .map((e) => e.id),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogTitle className="sr-only">Playback</DialogTitle>
        <div className="flex flex-col gap-3">
          <div
            ref={stageRef}
            className="relative flex items-center justify-center bg-muted/30 rounded-lg overflow-hidden"
            style={{ height: "60vh" }}
          >
            <div
              className="relative bg-white shadow-md rounded-xl overflow-hidden"
              style={{
                width: canvasSize.w,
                height: canvasSize.h,
                transform: `scale(${scale})`,
                transformOrigin: "center center",
                backgroundImage:
                  "linear-gradient(135deg, hsl(var(--background)) 0%, hsl(var(--muted)) 100%)",
              }}
            >
              {elements.map((el) => {
                const visible = visibleIds.has(el.id);
                return (
                  <div
                    key={el.id}
                    style={{
                      position: "absolute",
                      left: el.position.x,
                      top: el.position.y,
                      width: el.position.w,
                      height: el.position.h,
                      opacity: visible ? 1 : 0,
                      transition: "opacity 300ms ease",
                      zIndex: el.z_index,
                    }}
                  >
                    <AnimationBlockRenderer content={el.content} />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-md bg-muted/30 p-3 text-sm leading-7 max-h-32 overflow-y-auto">
            <ScriptHighlight text={script} revealedIdx={revealedWordIdx} />
          </div>
          <div className="flex justify-end gap-2">
            {playing ? (
              <Button variant="secondary" onClick={stop}>Stop</Button>
            ) : (
              <Button onClick={start}>Play with voice</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScriptHighlight({ text, revealedIdx }: { text: string; revealedIdx: number }) {
  const parts = useMemo(() => {
    const out: { word: boolean; text: string; idx?: number }[] = [];
    let last = 0;
    let i = 0;
    for (const m of text.matchAll(WORD_RE)) {
      const at = m.index ?? 0;
      if (at > last) out.push({ word: false, text: text.slice(last, at) });
      out.push({ word: true, text: m[0], idx: i++ });
      last = at + m[0].length;
    }
    if (last < text.length) out.push({ word: false, text: text.slice(last) });
    return out;
  }, [text]);
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((p, i) =>
        p.word ? (
          <span
            key={i}
            className={
              p.idx !== undefined && p.idx <= revealedIdx
                ? "bg-primary/20 text-primary font-semibold rounded px-0.5"
                : "text-muted-foreground"
            }
          >
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}
