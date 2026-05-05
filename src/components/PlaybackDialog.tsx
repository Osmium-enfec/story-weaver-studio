import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AnimationBlockRenderer, type AnimationBlockContent } from "@/components/AnimationBlock";
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
  aspect: string;
}

const WORD_RE = /[A-Za-z][A-Za-z0-9_-]*/g;

export function PlaybackDialog({ open, onOpenChange, script, elements, aspect }: Props) {
  // Map element.id -> the word index in the script it should reveal at
  const wordIndexById = useMemo(() => {
    const map = new Map<string, number>();
    if (!script) return map;
    // Build flat array of {text, index} of words
    const tokens: { text: string; idx: number }[] = [];
    let i = 0;
    for (const m of script.matchAll(WORD_RE)) {
      tokens.push({ text: m[0].toLowerCase(), idx: i++ });
    }
    for (const el of elements) {
      const w = el.content.word?.toLowerCase();
      if (!w) continue;
      const occ = el.content.occurrence ?? 1;
      let seen = 0;
      for (const t of tokens) {
        if (t.text === w) {
          seen++;
          if (seen === occ) {
            map.set(el.id, t.idx);
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

  useEffect(() => {
    if (!open) {
      window.speechSynthesis?.cancel();
      setPlaying(false);
      setRevealedWordIdx(-1);
    }
  }, [open]);

  function start() {
    if (!script.trim()) {
      toast.error("Add a script first");
      return;
    }
    if (!("speechSynthesis" in window)) {
      toast.error("Browser TTS not supported");
      return;
    }
    setRevealedWordIdx(-1);
    const u = new SpeechSynthesisUtterance(script);
    u.rate = 1;
    u.pitch = 1;
    let wordIdx = -1;
    u.onboundary = (e: SpeechSynthesisEvent) => {
      if (e.name !== "word") return;
      // Determine which word index we're on by counting WORD_RE matches up to charIndex
      const upto = script.slice(0, e.charIndex);
      const count = (upto.match(WORD_RE) || []).length;
      wordIdx = count; // current word being spoken is at index `count`
      setRevealedWordIdx(wordIdx);
    };
    u.onend = () => {
      setPlaying(false);
      // Reveal everything at the end
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

  // Visible elements: those bound to no word OR whose word index <= revealedWordIdx
  const visibleIds = new Set(
    elements
      .filter((el) => {
        const wIdx = wordIndexById.get(el.id);
        if (wIdx === undefined) return true; // unbound: show from start
        return wIdx <= revealedWordIdx;
      })
      .map((e) => e.id),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogTitle className="sr-only">Playback</DialogTitle>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-center bg-muted/30 p-3 rounded-lg">
            <div
              className="relative overflow-hidden rounded-xl bg-white shadow-md"
              style={{
                aspectRatio: aspect,
                width: "100%",
                maxHeight: "65vh",
                backgroundImage:
                  "linear-gradient(135deg, hsl(var(--background)) 0%, hsl(var(--muted)) 100%)",
              }}
            >
              {elements.map((el) => {
                const visible = visibleIds.has(el.id);
                return (
                  <div
                    key={el.id}
                    className="absolute transition-opacity duration-300"
                    style={{
                      left: `${(el.position.x / 1000) * 100}%`,
                      top: `${(el.position.y / 1000) * 100}%`,
                      width: `${(el.position.w / 1000) * 100}%`,
                      height: `${(el.position.h / 1000) * 100}%`,
                      // Use parent-relative px positions actually — fall back below
                      opacity: visible ? 1 : 0,
                      zIndex: el.z_index,
                    }}
                  >
                    <AbsoluteBlock el={el} visible={visible} />
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

// Render an element using its absolute pixel position relative to canvas.
// Since canvas size in dialog differs from editor, we position by px directly
// inside a container that matches the original canvas via aspect ratio scaling.
// Simpler: use absolute px (matches original sizing).
function AbsoluteBlock({ el, visible }: { el: PlaybackElement; visible: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: visible ? 1 : 0,
        transition: "opacity 300ms ease",
      }}
    >
      <AnimationBlockRenderer content={el.content} />
    </div>
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
