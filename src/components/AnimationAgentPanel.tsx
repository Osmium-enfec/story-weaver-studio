import { useState, useRef, useEffect, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Send, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { directProject } from "@/server/director.functions";
import { generateAssetImage } from "@/server/ai-image.functions";
import {
  planStoryboard,
  refineStoryboard,
  approveAndAnimate,
  type Storyboard,
} from "@/server/storyboard.functions";
import { proposeGrid, chooseGrid, type GridOption } from "@/server/grid.functions";

const GEN_IMAGE_RE = /^\s*(generate|create|make|draw)\s+(an?\s+)?(image|picture|illustration|icon|photo|3d\s+icon)\s+(of|for|showing|with)?\s*(.+)$/i;

type Mode = "grid" | "storyboard" | "refine-anim";

interface Message {
  role: "user" | "assistant";
  content: string;
  storyboard?: Storyboard;
  gridOptions?: GridOption[];
  scope?: "scene" | "all";
}

interface Props {
  projectId: string;
  activeSceneId?: string | null;
  activeSceneIndex: number;
  onApplied: (sceneId?: string) => Promise<void> | void;
}

const STORYBOARD_STARTERS = [
  "Make the flow more visual, fewer text beats",
  "Start with a punchy hook before the title",
  "Replace the diagram beat with a code snippet",
  "End with a recap callout",
];

const ANIM_STARTERS = [
  "Make this scene more dramatic with a strong focal asset",
  "Slow the entrances and stagger them more",
  "Use 1 big visual instead of a grid",
];

const APPROVE_RE = /^\s*(approve|approved|looks good|lgtm|ship it|animate it|go ahead|do it|yes,? animate)\b/i;

export function AnimationAgentPanel({ projectId, activeSceneId, activeSceneIndex, onApplied }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("grid");
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [chosenLayout, setChosenLayout] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"scene" | "all">("scene");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  // Reset chat when switching active canvas
  useEffect(() => {
    setMessages([]);
    setStoryboard(null);
    setChosenLayout(null);
    setMode("grid");
  }, [activeSceneId]);

  const startGridStage = useCallback(
    async (sceneId: string) => {
      setBusy(true);
      try {
        const res = await proposeGrid({ data: { sceneId } });
        setMode("grid");
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: `Step 1 — pick a grid for canvas ${activeSceneIndex + 1}. I suggested ${res.options.length} layouts based on ~${res.beatCount} beats. Click one to lock it in.`,
            gridOptions: res.options,
          },
        ]);
      } catch (e) {
        const msg = (e as Error).message || "Failed";
        setMessages((m) => [...m, { role: "assistant", content: `Error: ${msg}` }]);
        toast.error(msg);
      } finally {
        setBusy(false);
      }
    },
    [activeSceneIndex],
  );

  const generateStoryboard = useCallback(
    async (sceneId: string, instruction?: string) => {
      setBusy(true);
      try {
        const sb = await planStoryboard({ data: { sceneId, instruction } });
        setStoryboard(sb);
        setMode("storyboard");
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: `Step 2 — infographic for canvas ${activeSceneIndex + 1} (${sb.beats.length} beats). Tell me what to change, or click Approve & animate.`,
            storyboard: sb,
          },
        ]);
      } catch (e) {
        const msg = (e as Error).message || "Failed";
        setMessages((m) => [...m, { role: "assistant", content: `Error: ${msg}` }]);
        toast.error(msg);
      } finally {
        setBusy(false);
      }
    },
    [activeSceneIndex],
  );

  async function pickGrid(layoutId: string, layoutName: string) {
    if (!activeSceneId || busy) return;
    setBusy(true);
    try {
      await chooseGrid({ data: { sceneId: activeSceneId, layoutId } });
      setChosenLayout(layoutId);
      setMessages((m) => [
        ...m,
        { role: "user", content: `Use the "${layoutName}" grid` },
      ]);
      // Move on to storyboard generation immediately
      await generateStoryboard(activeSceneId);
    } catch (e) {
      const msg = (e as Error).message || "Failed to pick grid";
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${msg}` }]);
      toast.error(msg);
      setBusy(false);
    }
  }

  // Listen for toolbar trigger
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ sceneId: string }>).detail;
      if (!detail?.sceneId) return;
      setOpen(true);
      setScope("scene");
      setMode("grid");
      setStoryboard(null);
      setChosenLayout(null);
      void startGridStage(detail.sceneId);
    }
    window.addEventListener("open-storyboard-agent", handler as EventListener);
    return () => window.removeEventListener("open-storyboard-agent", handler as EventListener);
  }, [startGridStage]);

  async function approveCurrent() {
    if (!activeSceneId || !storyboard) return;
    setBusy(true);
    try {
      const res = await approveAndAnimate({ data: { sceneId: activeSceneId } });
      setMode("refine-anim");
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Animated canvas ${activeSceneIndex + 1}: ${res.elementsInserted} elements placed. You can now refine the animation in chat.`,
        },
      ]);
      await onApplied(activeSceneId);
    } catch (e) {
      const msg = (e as Error).message || "Approve failed";
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${msg}` }]);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function send(text: string) {
    const instruction = text.trim();
    if (!instruction || busy) return;
    const targetSceneId = scope === "scene" ? activeSceneId ?? undefined : undefined;
    if (scope === "scene" && !targetSceneId) {
      toast.error("Open a canvas first");
      return;
    }
    setMessages((m) => [...m, { role: "user", content: instruction, scope }]);
    setInput("");

    // Natural-language approval shortcut while in storyboard mode
    if (scope === "scene" && mode === "storyboard" && storyboard && APPROVE_RE.test(instruction)) {
      await approveCurrent();
      return;
    }

    // Natural-language image generation: "generate an image of X"
    const genMatch = instruction.match(GEN_IMAGE_RE);
    if (genMatch) {
      const subject = genMatch[5].trim();
      const style = /icon/i.test(genMatch[3]) ? "icon" : /photo/i.test(genMatch[3]) ? "photo" : "illustration";
      setBusy(true);
      try {
        const img = await generateAssetImage({
          data: { projectId, sceneId: activeSceneId ?? undefined, prompt: subject, style },
        });
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `Generated image "${img.name}". Added to the asset library — ask me to "use it" or refine the storyboard to include it.\n\n![generated](${img.url})` },
        ]);
      } catch (e) {
        const msg = (e as Error).message || "Image generation failed";
        setMessages((m) => [...m, { role: "assistant", content: `Error: ${msg}` }]);
        toast.error(msg);
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      if (scope === "scene" && mode === "storyboard" && targetSceneId) {
        // Refine (or first-time generate) storyboard
        const fn = storyboard ? refineStoryboard : planStoryboard;
        const sb = await fn({ data: { sceneId: targetSceneId, instruction } });
        setStoryboard(sb);
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `Updated storyboard (${sb.beats.length} beats).`, storyboard: sb },
        ]);
      } else {
        // Animation refinement (post-approval, or all-canvases scope)
        const res = await directProject({
          data: { projectId, replace: true, sceneId: targetSceneId, instruction },
        });
        const reply =
          scope === "scene"
            ? `Refined animation on canvas ${activeSceneIndex + 1}: ${res.elementsInserted} elements${res.scenesFallback ? " (fell back)" : ""}.`
            : `Refined ${res.scenesPlanned}/${res.sceneCount} canvases (${res.elementsInserted} elements${res.scenesFallback ? `, ${res.scenesFallback} fell back` : ""}).`;
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
        await onApplied(targetSceneId);
      }
    } catch (e) {
      const msg = (e as Error).message || "Agent failed";
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${msg}` }]);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const showStoryboardCta = scope === "scene" && mode === "storyboard" && !!activeSceneId;
  const starters = mode === "grid" ? [] : mode === "storyboard" ? STORYBOARD_STARTERS : ANIM_STARTERS;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="default" size="sm" className="fixed bottom-6 right-6 z-40 shadow-lg gap-2">
          <Sparkles className="h-4 w-4" />
          AI Agent
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px] flex flex-col p-0">
        <SheetHeader className="px-4 py-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Animation Agent
          </SheetTitle>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4 py-2 border-b text-xs flex-wrap">
          <span className="text-muted-foreground">Scope:</span>
          <Button
            variant={scope === "scene" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setScope("scene")}
          >
            This canvas
          </Button>
          <Button
            variant={scope === "all" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setScope("all")}
          >
            All canvases
          </Button>
          {scope === "scene" && (
            <>
              <span className="ml-2 text-muted-foreground">Stage:</span>
              <StageBadge label="1. Grid" active={mode === "grid"} done={!!chosenLayout} />
              <StageBadge label="2. Infographic" active={mode === "storyboard"} done={!!storyboard && storyboard.status === "approved"} />
              <StageBadge label="3. Animation" active={mode === "refine-anim"} done={false} />
            </>
          )}
        </div>

        <ScrollArea className="flex-1">
          <div ref={scrollRef} className="p-4 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {mode === "grid"
                    ? "Step 1 — pick a grid layout for this canvas. Then I'll fill it as an infographic, then animate it word-by-word."
                    : mode === "storyboard"
                      ? "Step 2 — refine the infographic. Approve when it looks right, then I'll animate it synced to your voice."
                      : "Step 3 — refine the existing animation on this canvas."}
                </p>
                {scope === "scene" && activeSceneId && mode === "grid" && (
                  <Button
                    size="sm"
                    onClick={() => activeSceneId && startGridStage(activeSceneId)}
                    disabled={busy}
                    className="gap-2"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Suggest grids
                  </Button>
                )}
                {showStoryboardCta && !storyboard && mode === "storyboard" && (
                  <Button
                    size="sm"
                    onClick={() => activeSceneId && generateStoryboard(activeSceneId)}
                    disabled={busy}
                    className="gap-2"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Generate storyboard
                  </Button>
                )}
                <div className="flex flex-col gap-2">
                  {starters.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      disabled={busy}
                      className="text-left text-xs px-3 py-2 rounded-md border hover:bg-accent transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`text-sm rounded-md px-3 py-2 ${
                  m.role === "user" ? "bg-primary text-primary-foreground ml-8" : "bg-muted mr-8"
                }`}
              >
                {m.role === "user" && m.scope === "all" && (
                  <div className="text-[10px] opacity-70 mb-1">All canvases</div>
                )}
                <div className="whitespace-pre-wrap">{m.content}</div>
                {m.gridOptions && (
                  <GridOptionsPicker options={m.gridOptions} busy={busy} onPick={pickGrid} />
                )}
                {m.storyboard && <StoryboardPreview sb={m.storyboard} />}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mr-8">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Working…
              </div>
            )}
          </div>
        </ScrollArea>

        {showStoryboardCta && storyboard && (
          <div className="border-t px-3 py-2 flex items-center justify-between gap-2 bg-muted/40">
            <span className="text-xs text-muted-foreground">
              Status: <span className="font-medium text-foreground">{storyboard.status}</span> · {storyboard.beats.length} beats
            </span>
            <Button size="sm" onClick={approveCurrent} disabled={busy} className="gap-1.5 h-8">
              <Check className="h-3.5 w-3.5" />
              Approve & animate
            </Button>
          </div>
        )}

        <div className="border-t p-3 space-y-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={
              mode === "grid"
                ? "Pick a grid above, or type to suggest a different one (e.g. 'use two columns')"
                : mode === "storyboard"
                  ? "e.g. Make beat 2 a code snippet — or type 'approve' to animate"
                  : scope === "scene"
                    ? "e.g. Make the icon bigger and centered"
                    : "e.g. Use a consistent slide-up entrance everywhere"
            }
            className="min-h-[70px] resize-none text-sm"
            disabled={busy}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => send(input)} disabled={busy || !input.trim()} className="gap-1">
              <Send className="h-3.5 w-3.5" />
              Send
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StageBadge({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full border ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : done
            ? "bg-green-100 text-green-900 border-green-300"
            : "bg-muted text-muted-foreground border-border"
      }`}
    >
      {label}
      {done ? " ✓" : ""}
    </span>
  );
}

function GridOptionsPicker({
  options,
  busy,
  onPick,
}: {
  options: GridOption[];
  busy: boolean;
  onPick: (id: string, name: string) => void;
}) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onPick(o.id, o.name)}
          disabled={busy}
          title={`${o.name} — ${o.description}`}
          className="text-left rounded-md border bg-background hover:border-primary transition-colors p-1 disabled:opacity-60"
        >
          <div
            className="rounded overflow-hidden"
            // SVG generated server-side from a strict shape
            dangerouslySetInnerHTML={{ __html: o.svg }}
          />
          <div className="mt-1 text-[10px] font-semibold leading-tight truncate">{o.name}</div>
        </button>
      ))}
    </div>
  );
}

function StoryboardPreview({ sb }: { sb: Storyboard }) {
  return (
    <div className="mt-2 space-y-2">
      <div
        className="rounded-md border bg-background p-2 overflow-x-auto"
        // SVG is server-generated from a strict schema (no user-controlled raw HTML)
        dangerouslySetInnerHTML={{ __html: sb.svg }}
      />
      <ol className="text-xs space-y-1 list-decimal list-inside">
        {sb.beats.map((b) => (
          <li key={b.id}>
            <span className="font-medium">[{b.kind}]</span> {b.label}
            {b.asset_query ? <span className="text-muted-foreground"> · {b.asset_query}</span> : null}
            <span className="text-muted-foreground"> · @word {b.anchor_word_index}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
