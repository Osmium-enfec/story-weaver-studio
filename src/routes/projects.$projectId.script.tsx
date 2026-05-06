import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { toPng } from "html-to-image";
import { supabase } from "@/integrations/supabase/client";
import { useProject } from "@/components/project-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { toolbarStore } from "@/components/toolbar-store";
import { AnimationSearchPanel } from "@/components/AnimationSearchPanel";
import { AnimationBlockRenderer, type AnimationBlockContent } from "@/components/AnimationBlock";
import { BackgroundPicker, BackgroundLayer, type SceneBackground } from "@/components/BackgroundPicker";
import { PlaybackDialog } from "@/components/PlaybackDialog";
import type { AnimationResult } from "@/lib/animation-providers";
import { cacheIconscoutItem } from "@/server/iconscout-mirror.functions";
import { proxyImageAsDataUrl } from "@/server/proxy-image.functions";

async function inlineAllImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) return;
      try {
        const { dataUrl } = await proxyImageAsDataUrl({ data: { url: src } });
        img.setAttribute("src", dataUrl);
        img.setAttribute("crossorigin", "anonymous");
      } catch {
        // ignore
      }
    }),
  );
}

export const Route = createFileRoute("/projects/$projectId/script")({
  component: ScriptCanvas,
});

interface PlacedElement {
  id: string;
  scene_id: string;
  type: string;
  content: AnimationBlockContent;
  position: { x: number; y: number; w: number; h: number };
  z_index: number;
}

interface SceneRow {
  id: string;
  order_index: number;
  background: SceneBackground;
  narration: string;
  elements: PlacedElement[];
}

const DEFAULT_BG: SceneBackground = { type: "color", value: "#ffffff" };

function ScriptCanvas() {
  const { projectId } = useParams({ from: "/projects/$projectId/script" });
  const { project } = useProject();
  const [scenes, setScenes] = useState<SceneRow[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [editingScript, setEditingScript] = useState<Record<string, boolean>>({});
  const canvasRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const narrationTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [playOpen, setPlayOpen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 1280, h: 720 });

  const activeScene = scenes[activeIdx];

  async function updateBackground(bg: SceneBackground, applyAll: boolean) {
    if (!scenes.length || !activeScene) return;
    const targets = applyAll ? scenes : [activeScene];
    setScenes((prev) => prev.map((s) => (applyAll || s.id === activeScene.id ? { ...s, background: bg } : s)));
    await Promise.all(
      targets.map((s) => supabase.from("scenes").update({ background: bg as unknown as never }).eq("id", s.id)),
    );
  }

  function updateNarration(sceneId: string, narration: string) {
    setScenes((prev) => prev.map((s) => (s.id === sceneId ? { ...s, narration } : s)));
    if (narrationTimers.current[sceneId]) clearTimeout(narrationTimers.current[sceneId]);
    narrationTimers.current[sceneId] = setTimeout(() => {
      void supabase.from("scenes").update({ narration }).eq("id", sceneId);
    }, 500);
  }

  async function flushNarration(sceneId: string, narration: string) {
    if (narrationTimers.current[sceneId]) {
      clearTimeout(narrationTimers.current[sceneId]);
      delete narrationTimers.current[sceneId];
    }
    await supabase.from("scenes").update({ narration }).eq("id", sceneId);
  }

  // Flush pending narration saves before unload
  useEffect(() => {
    function onBeforeUnload() {
      for (const sceneId of Object.keys(narrationTimers.current)) {
        clearTimeout(narrationTimers.current[sceneId]);
        const s = scenes.find((x) => x.id === sceneId);
        if (s) {
          // fire-and-forget; browser will send before unload
          void supabase.from("scenes").update({ narration: s.narration }).eq("id", sceneId);
        }
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [scenes]);

  useEffect(() => {
    if (!isPlaying) return;
    const t = setTimeout(() => setIsPlaying(false), 4000);
    return () => clearTimeout(t);
  }, [isPlaying]);

  // Delete/Backspace removes selected element on canvas
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!selectedElementId) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      for (const s of scenes) {
        if (s.elements.some((el) => el.id === selectedElementId)) {
          void deleteElement(s.id, selectedElementId);
          setSelectedElementId(null);
          break;
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedElementId, scenes]);

  async function exportVideo() {
    const node = canvasRefs.current[activeScene?.id ?? ""];
    if (!node) return;
    setIsExporting(true);
    try {
      const rect = node.getBoundingClientRect();
      const off = document.createElement("canvas");
      off.width = Math.round(rect.width);
      off.height = Math.round(rect.height);
      const ctx = off.getContext("2d")!;
      const stream = (off as HTMLCanvasElement).captureStream(30);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
      });
      recorder.start();
      await inlineAllImages(node);
      setIsPlaying(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const totalMs = 4000;
      const start = performance.now();
      while (performance.now() - start < totalMs) {
        const dataUrl = await toPng(node, {
          cacheBust: false,
          pixelRatio: 1,
          backgroundColor: "#ffffff",
          skipFonts: true,
          imagePlaceholder: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>",
        });
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = dataUrl;
        });
        ctx.clearRect(0, 0, off.width, off.height);
        ctx.drawImage(img, 0, 0, off.width, off.height);
        await new Promise((r) => setTimeout(r, 100));
      }
      recorder.stop();
      const blob = await done;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.title || "code-motion"}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Video exported");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsExporting(false);
      setIsPlaying(false);
    }
  }

  useEffect(() => {
    toolbarStore.set([
      {
        label: "Preview",
        icon: "play",
        variant: "default",
        disabled: isExporting,
        onClick: () => {
          const node = canvasRefs.current[activeScene?.id ?? ""];
          if (node) {
            const r = node.getBoundingClientRect();
            setCanvasSize({ w: Math.round(r.width), h: Math.round(r.height) });
          }
          setPlayOpen(true);
        },
      },
      {
        label: isExporting ? "Exporting…" : "Export",
        icon: "download",
        variant: "outline",
        disabled: isExporting,
        onClick: exportVideo,
      },
    ]);
    return () => toolbarStore.clear();
  }, [isPlaying, isExporting, activeScene?.id]);

  // Load all scenes + their elements
  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase
        .from("scenes")
        .select("id, order_index, background, narration")
        .eq("project_id", projectId)
        .order("order_index");
      let sceneRows = (rows ?? []) as { id: string; order_index: number; background: SceneBackground | null; narration: string | null }[];

      if (sceneRows.length === 0) {
        const { data: created, error } = await supabase
          .from("scenes")
          .insert({
            project_id: projectId,
            order_index: 0,
            narration: "",
            visual_brief: "",
            detected_concepts: [],
            duration_ms: 8000,
          })
          .select("id, order_index, background, narration")
          .single();
        if (error) return toast.error(error.message);
        sceneRows = [created as never];
      }

      const ids = sceneRows.map((s) => s.id);
      const { data: els } = await supabase
        .from("scene_elements")
        .select("*")
        .in("scene_id", ids)
        .order("z_index");
      const byScene = new Map<string, PlacedElement[]>();
      for (const id of ids) byScene.set(id, []);
      for (const e of (els ?? []) as unknown as PlacedElement[]) {
        byScene.get(e.scene_id)?.push(e);
      }
      setScenes(
        sceneRows.map((s) => ({
          id: s.id,
          order_index: s.order_index,
          background: (s.background ?? DEFAULT_BG) as SceneBackground,
          narration: s.narration ?? "",
          elements: byScene.get(s.id) ?? [],
        })),
      );
      setActiveIdx(0);
    })();
  }, [projectId]);

  const ratio = project.aspect_ratio;
  const aspect = ratio === "9:16" ? "9 / 16" : ratio === "1:1" ? "1 / 1" : "16 / 9";

  async function addCanvas() {
    const order_index = scenes.length;
    const { data, error } = await supabase
      .from("scenes")
      .insert({
        project_id: projectId,
        order_index,
        narration: "",
        visual_brief: "",
        detected_concepts: [],
        duration_ms: 8000,
      })
      .select("id, order_index, background, narration")
      .single();
    if (error) return toast.error(error.message);
    const r = data as { id: string; order_index: number; background: SceneBackground | null; narration: string | null };
    setScenes((prev) => [
      ...prev,
      { id: r.id, order_index: r.order_index, background: r.background ?? DEFAULT_BG, narration: r.narration ?? "", elements: [] },
    ]);
    setActiveIdx(scenes.length);
  }

  async function deleteCanvas(idx: number) {
    if (scenes.length <= 1) return toast.error("At least one canvas required");
    const s = scenes[idx];
    await supabase.from("scenes").delete().eq("id", s.id);
    setScenes((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((cur) => Math.max(0, Math.min(cur, scenes.length - 2)));
  }

  async function addAnimation(a: AnimationResult) {
    if (!activeScene) return;
    const node = canvasRefs.current[activeScene.id];
    if (!node) return;

    let localVideoUrl = a.video_url ?? null;
    if (a.provider === "iconscout" && a.external_id && a.video_url) {
      try {
        const res = await cacheIconscoutItem({
          data: {
            external_id: a.external_id,
            uuid: a.id.replace(/^iconscout:/, ""),
            name: a.name,
            slug: a.slug,
            preview_url: a.video_url,
            category: a.category,
          },
        });
        if (res.video_url) localVideoUrl = res.video_url;
      } catch (e) {
        toast.error(`Cache failed: ${(e as Error).message}`);
      }
    }

    const rect = node.getBoundingClientRect();
    const w = Math.round(rect.width * 0.3);
    const h = Math.round(rect.height * 0.3);
    const x = Math.round((rect.width - w) / 2);
    const y = Math.round((rect.height - h) / 2);

    const content: AnimationBlockContent = {
      provider: a.provider,
      name: a.name,
      slug: a.slug,
      lottie_url: a.lottie_url ?? null,
      video_url: localVideoUrl,
      external_id: a.external_id ?? null,
      loop: true,
      autoplay: true,
      speed: 1,
      opacity: 1,
      rotation: 0,
      color_support: a.color_support,
      tint: null,
      word: selectedWord,
      occurrence: selectedWord
        ? activeScene.elements.filter((e) => (e.content.word ?? "").toLowerCase() === selectedWord.toLowerCase()).length + 1
        : null,
    };
    const { data, error } = await supabase
      .from("scene_elements")
      .insert({
        scene_id: activeScene.id,
        type: a.provider === "internal" ? "animation" : a.provider === "iconscout" ? "iconscout" : "lottie",
        content: content as unknown as never,
        position: { x, y, w, h },
        z_index: activeScene.elements.length,
      })
      .select("*")
      .single();
    if (error) return toast.error(error.message);
    const newEl = data as unknown as PlacedElement;
    setScenes((prev) => prev.map((s) => (s.id === activeScene.id ? { ...s, elements: [...s.elements, newEl] } : s)));
    setSelectedElementId(newEl.id);
  }

  async function updateElement(sceneId: string, id: string, position: PlacedElement["position"]) {
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId ? { ...s, elements: s.elements.map((e) => (e.id === id ? { ...e, position } : e)) } : s,
      ),
    );
    await supabase.from("scene_elements").update({ position }).eq("id", id);
  }

  async function deleteElement(sceneId: string, id: string) {
    setScenes((prev) =>
      prev.map((s) => (s.id === sceneId ? { ...s, elements: s.elements.filter((e) => e.id !== id) } : s)),
    );
    await supabase.from("scene_elements").delete().eq("id", id);
  }

  return (
    <div className="flex gap-4">
      {/* MAIN — scrollable list of canvases each with its own script */}
      <div className="flex w-3/4 flex-col gap-4">
        {scenes.map((s, idx) => (
          <div
            key={s.id}
            className={`flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition ${
              idx === activeIdx ? "border-primary" : "border-border"
            }`}
            onMouseDown={() => setActiveIdx(idx)}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Canvas {idx + 1}
              </span>
              {scenes.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs text-destructive"
                  onClick={(e) => { e.stopPropagation(); void deleteCanvas(idx); }}
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </Button>
              )}
            </div>
            <div className="flex justify-center bg-muted/30 p-4">
              <div
                ref={(el) => { canvasRefs.current[s.id] = el; }}
                className="relative w-full overflow-hidden rounded-xl bg-white shadow-md"
                style={{ aspectRatio: aspect }}
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) setSelectedElementId(null);
                }}
              >
                <BackgroundLayer background={s.background} exportMode={isExporting} />
                {s.elements.map((el) => (
                  <Rnd
                    key={el.id}
                    bounds="parent"
                    size={{ width: el.position.w, height: el.position.h }}
                    position={{ x: el.position.x, y: el.position.y }}
                    onDragStop={(_, d) => {
                      void updateElement(s.id, el.id, { ...el.position, x: d.x, y: d.y });
                    }}
                    onResizeStop={(_, __, ref, ____, pos) => {
                      void updateElement(s.id, el.id, {
                        x: pos.x,
                        y: pos.y,
                        w: parseInt(ref.style.width),
                        h: parseInt(ref.style.height),
                      });
                    }}
                    onMouseDown={() => { setActiveIdx(idx); setSelectedElementId(el.id); }}
                    className={`group/el rounded-lg border-2 ${
                      selectedElementId === el.id ? "border-primary" : "border-transparent hover:border-primary/40"
                    }`}
                  >
                    <div className={`relative h-full w-full ${isPlaying ? "animate-fade-in" : ""}`}>
                      <AnimationBlockRenderer content={el.content} exportMode={isExporting} />
                      {selectedElementId === el.id && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteElement(s.id, el.id); }}
                          className="absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </Rnd>
                ))}
                {s.elements.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                    Add an animation from the right panel →
                  </div>
                )}
              </div>
            </div>
            {/* Per-canvas script */}
            <div className="border-t border-border p-3">
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Script for Canvas {idx + 1}
                  {idx === activeIdx && selectedWord && (
                    <span className="ml-2 normal-case text-primary">· {selectedWord}</span>
                  )}
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editingScript[s.id]) void flushNarration(s.id, s.narration);
                    setEditingScript((m) => ({ ...m, [s.id]: !m[s.id] }));
                  }}
                >
                  {editingScript[s.id] ? "Done" : "Edit"}
                </Button>
              </div>
              {editingScript[s.id] ? (
                <Textarea
                  value={s.narration}
                  onChange={(e) => updateNarration(s.id, e.target.value)}
                  placeholder="What is narrated while this canvas plays…"
                  className="min-h-[80px] resize-y text-sm"
                />
              ) : s.narration ? (
                <div className="rounded-md bg-muted/30 p-2 text-sm leading-7">
                  <ClickableScript
                    text={s.narration}
                    selected={idx === activeIdx ? selectedWord : null}
                    boundWords={new Set(s.elements.map((e) => (e.content.word ?? "").toLowerCase()).filter(Boolean))}
                    onWordClick={(w) => { setActiveIdx(idx); setSelectedWord(w); }}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No script yet. Click Edit to add one.</p>
              )}
            </div>
          </div>
        ))}
        <Button variant="outline" className="w-full gap-1.5" onClick={addCanvas}>
          <Plus className="h-4 w-4" /> Add canvas
        </Button>
      </div>

      {/* RIGHT — animations + background tabs (sticky) */}
      <aside className="w-1/4">
        <div
          className="sticky top-4 flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          style={{ height: "calc(100vh - 9rem)" }}
        >
          <Tabs defaultValue="animations" className="flex h-full flex-col">
            <TabsList className="m-3 grid grid-cols-2">
              <TabsTrigger value="animations">Animations</TabsTrigger>
              <TabsTrigger value="background">Background</TabsTrigger>
            </TabsList>
            <TabsContent value="animations" className="m-0 min-h-0 flex-1 overflow-hidden border-t border-border">
              <div className="border-b border-border px-4 py-2">
                <p className="text-xs text-muted-foreground">Adds to Canvas {activeIdx + 1}</p>
              </div>
              <div className="min-h-0 flex-1">
                <AnimationSearchPanel initialQuery={selectedWord ?? ""} onSelect={addAnimation} />
              </div>
            </TabsContent>
            <TabsContent value="background" className="m-0 min-h-0 flex-1 overflow-y-auto border-t border-border">
              {activeScene && (
                <BackgroundPicker
                  inline
                  value={activeScene.background}
                  onChange={(bg) => updateBackground(bg, false)}
                  applyToAll={false}
                  onApplyToAllChange={(v) => { if (v) void updateBackground(activeScene.background, true); }}
                />
              )}
              {activeScene && (
                <div className="border-t border-border p-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    onClick={() => void updateBackground(activeScene.background, true)}
                  >
                    Apply current background to all pages
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </aside>

      <PlaybackDialog
        open={playOpen}
        onOpenChange={setPlayOpen}
        script={scenes.map((s) => s.narration).filter(Boolean).join("\n\n")}
        scenes={scenes.map((s) => ({
          id: s.id,
          background: s.background,
          elements: s.elements.map((e) => ({
            id: e.id,
            content: e.content,
            position: e.position,
            z_index: e.z_index,
          })),
        }))}
        canvasSize={canvasSize}
      />
    </div>
  );
}

const WORD_RE = /[A-Za-z][A-Za-z0-9_-]*/g;

function ClickableScript({
  text,
  selected,
  boundWords,
  onWordClick,
}: {
  text: string;
  selected: string | null;
  boundWords?: Set<string>;
  onWordClick: (w: string) => void;
}) {
  const tokens: { word: boolean; text: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) tokens.push({ word: false, text: text.slice(last, idx) });
    tokens.push({ word: true, text: m[0] });
    last = idx + m[0].length;
  }
  if (last < text.length) tokens.push({ word: false, text: text.slice(last) });
  return (
    <p className="whitespace-pre-wrap">
      {tokens.map((t, i) => {
        if (!t.word) return <span key={i}>{t.text}</span>;
        const lower = t.text.toLowerCase();
        const isSelected = selected?.toLowerCase() === lower;
        const isBound = boundWords?.has(lower);
        return (
          <button
            key={i}
            onClick={(e) => { e.stopPropagation(); onWordClick(t.text); }}
            className={`rounded px-0.5 transition ${
              isSelected
                ? "bg-primary/20 text-primary font-semibold"
                : isBound
                  ? "bg-accent/40 text-accent-foreground underline decoration-dotted underline-offset-4"
                  : "hover:bg-muted"
            }`}
          >
            {t.text}
          </button>
        );
      })}
    </p>
  );
}
