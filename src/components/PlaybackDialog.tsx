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

export interface PlaybackScene {
  id: string;
  background: SceneBackground;
  elements: PlaybackElement[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  script: string;
  scenes: PlaybackScene[];
  /** Original canvas pixel size when elements were placed */
  canvasSize: { w: number; h: number };
}

const SCENE_DURATION_MS = 3500;
const TRANSITION_MS = 600;

export function PlaybackDialog({ open, onOpenChange, script, scenes, canvasSize }: Props) {
  const [playing, setPlaying] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!open) {
      window.speechSynthesis?.cancel();
      setPlaying(false);
      setCurrentIdx(0);
      setTransitioning(false);
      if (timerRef.current) clearTimeout(timerRef.current);
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

  function advance(from: number) {
    if (from + 1 >= scenes.length) {
      setPlaying(false);
      return;
    }
    setTransitioning(true);
    timerRef.current = setTimeout(() => {
      setCurrentIdx(from + 1);
      setTransitioning(false);
      timerRef.current = setTimeout(() => advance(from + 1), SCENE_DURATION_MS);
    }, TRANSITION_MS);
  }

  function start() {
    if (scenes.length === 0) return toast.error("Add a canvas first");
    setCurrentIdx(0);
    setTransitioning(false);
    setPlaying(true);
    if (script.trim() && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(script);
      u.rate = 1;
      utterRef.current = u;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => advance(0), SCENE_DURATION_MS);
  }

  function stop() {
    window.speechSynthesis?.cancel();
    if (timerRef.current) clearTimeout(timerRef.current);
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
              {current?.elements.map((el) => (
                <div
                  key={el.id}
                  style={{
                    position: "absolute",
                    left: el.position.x,
                    top: el.position.y,
                    width: el.position.w,
                    height: el.position.h,
                    zIndex: el.z_index,
                  }}
                >
                  <AnimationBlockRenderer content={el.content} />
                </div>
              ))}
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
