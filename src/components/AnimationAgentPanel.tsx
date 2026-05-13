import { useState, useRef, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { directProject } from "@/server/director.functions";

interface Message {
  role: "user" | "assistant";
  content: string;
  sceneId?: string;
  scope?: "scene" | "all";
}

interface Props {
  projectId: string;
  activeSceneId?: string | null;
  activeSceneIndex: number;
  onApplied: (sceneId?: string) => Promise<void> | void;
}

const STARTERS = [
  "Make this scene more dramatic with a strong focal asset",
  "Slow the entrances down and stagger them more",
  "Use 1 big visual instead of a grid",
  "Add a code-style title card at the start",
];

export function AnimationAgentPanel({ projectId, activeSceneId, activeSceneIndex, onApplied }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"scene" | "all">("scene");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  async function send(text: string) {
    const instruction = text.trim();
    if (!instruction || busy) return;
    const targetSceneId = scope === "scene" ? activeSceneId ?? undefined : undefined;
    if (scope === "scene" && !targetSceneId) {
      toast.error("Open a canvas first");
      return;
    }
    setMessages((m) => [
      ...m,
      { role: "user", content: instruction, sceneId: targetSceneId, scope },
    ]);
    setInput("");
    setBusy(true);
    try {
      const res = await directProject({
        data: {
          projectId,
          replace: true,
          sceneId: targetSceneId,
          instruction,
        },
      });
      const reply =
        scope === "scene"
          ? `Refined canvas ${activeSceneIndex + 1}: ${res.elementsInserted} elements${
              res.scenesFallback ? " (fell back)" : ""
            }.`
          : `Refined ${res.scenesPlanned}/${res.sceneCount} canvases (${res.elementsInserted} elements${
              res.scenesFallback ? `, ${res.scenesFallback} fell back` : ""
            }).`;
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      await onApplied(targetSceneId);
    } catch (e) {
      const msg = (e as Error).message || "Agent failed";
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${msg}` }]);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="default"
          size="sm"
          className="fixed bottom-6 right-6 z-40 shadow-lg gap-2"
        >
          <Sparkles className="h-4 w-4" />
          AI Agent
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] flex flex-col p-0">
        <SheetHeader className="px-4 py-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Animation Agent
          </SheetTitle>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4 py-2 border-b text-xs">
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
        </div>

        <ScrollArea className="flex-1">
          <div ref={scrollRef} className="p-4 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Tell the agent how to refine the animation. It will pick assets, layout, and timing for you.
                </p>
                <div className="flex flex-col gap-2">
                  {STARTERS.map((s) => (
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
                  m.role === "user"
                    ? "bg-primary text-primary-foreground ml-8"
                    : "bg-muted mr-8"
                }`}
              >
                {m.role === "user" && m.scope === "all" && (
                  <div className="text-[10px] opacity-70 mb-1">All canvases</div>
                )}
                {m.content}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mr-8">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Directing…
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t p-3 space-y-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={
              scope === "scene"
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
