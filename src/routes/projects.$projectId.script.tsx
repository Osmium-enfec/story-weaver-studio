import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { toPng } from "html-to-image";
import { supabase } from "@/integrations/supabase/client";
import { useProject } from "@/components/project-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Pencil, Save, Trash2, Plus } from "lucide-react";
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
  elements: PlacedElement[];
}

const WORD_RE = /[A-Za-z][A-Za-z0-9_-]*/g;
const DEFAULT_BG: SceneBackground = { type: "color", value: "#ffffff" };

function ScriptCanvas() {
  const { projectId } = useParams({ from: "/projects/$projectId/script" });
  const { project, reload } = useProject();
  const [script, setScript] = useState(project.script ?? "");
  const [editing, setEditing] = useState(!project.script);
  const [scenes, setScenes] = useState<SceneRow[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const canvasRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [playOpen, setPlayOpen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 1280, h: 720 });

  const activeScene = scenes[activeIdx];

  async function updateBackground(bg: SceneBackground, applyAll: boolean) {
    if (!scenes.length) return;
    const targets = applyAll ? scenes : [activeScene];
    setScenes((prev) => prev.map((s) => (applyAll || s.id === activeScene.id ? { ...s, background: bg } : s)));
    await Promise.all(
      targets.map((s) =>
        supabase.from("scenes").update({ background: bg as unknown as never }).eq("id", s.id),
      ),
    );
  }

  useEffect(() => {
    if (!isPlaying) return;
    const t = setTimeout(() => setIsPlaying(false), 4000);
    return () => clearTimeout(t);
  }, [isPlaying]);

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
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
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

  useEffect(() => setScript(project.script ?? ""), [project.script]);

  // Load all scenes + their elements
  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase
        .from("scenes")
        .select("id, order_index, background")
        .eq("project_id", projectId)
        .order("order_index");
      let sceneRows = (rows ?? []) as { id: string; order_index: number; background: SceneBackground | null }[];

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
          .select("id, order_index, background")
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
          elements: byScene.get(s.id) ?? [],
        })),
      );
      setActiveIdx(0);
    })();
  }, [projectId]);

  const ratio = project.aspect_ratio;
  const aspect = ratio === "9:16" ? "9 / 16" : ratio === "1:1" ? "1 / 1" : "16 / 9";

  async function saveScript() {
    const { error } = await supabase.from("projects").update({ script }).eq("id", projectId);
    if (error) return toast.error(error.message);
    toast.success("Script saved");
    setEditing(false);
    reload();
  }

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
      .select("id, order_index, background")
      .single();
    if (error) return toast.error(error.message);
    const r = data as { id: string; order_index: number; background: SceneBackground | null };
    setScenes((prev) => [...prev, { id: r.id, order_index: r.order_index, background: (r.background ?? DEFAULT_BG), elements: [] }]);
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
    const boundWord = selectedWord ?? null;
    const occurrence = boundWord
      ? activeScene.elements.filter((e) => (e.content.word ?? "").toLowerCase() === boundWord.toLowerCase()).length + 1
      : null;

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
      word: boundWord,
      occurrence,
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
    setScenes((prev) =>
      prev.map((s) => (s.id === activeScene.id ? { ...s, elements: [...s.elements, newEl] } : s)),
    );
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
    <div className="flex gap-4" style={{ height: "calc(100vh - 9rem)" }}>
      {/* MAIN — canvases + script */}
      <div className="flex h-full w-3/4 flex-col gap-3 overflow-hidden">
        <div className="flex min-h-0 flex-[3] flex-col gap-3 overflow-y-auto pr-1">
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
              <div className="flex items-center justify-center bg-muted/30 p-4">
                <div
                  ref={(el) => { canvasRefs.current[s.id] = el; }}
                  className="relative w-full max-w-full overflow-hidden rounded-xl bg-white shadow-md"
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
                        selectedElementId === el.id
                          ? "border-primary"
                          : "border-transparent hover:border-primary/40"
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
                      Click a word below, then pick an animation →
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          <Button variant="outline" className="w-full gap-1.5" onClick={addCanvas}>
            <Plus className="h-4 w-4" /> Add canvas
          </Button>
        </div>

        {/* Script */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Script {selectedWord && <span className="ml-2 text-primary">· {selectedWord}</span>}
            </h3>
            {editing ? (
              <Button size="sm" onClick={saveScript} className="gap-1">
                <Save className="h-3.5 w-3.5" /> Save
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} className="gap-1">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
          </div>
          {editing ? (
            <Textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Type your lesson script…"
              className="min-h-0 flex-1 resize-none font-mono text-sm"
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md bg-muted/30 p-3 text-sm leading-7">
              {script ? (
                <ClickableScript
                  text={script}
                  selected={selectedWord}
                  onWordClick={(w) => setSelectedWord(w)}
                />
              ) : (
                <p className="text-muted-foreground">No script yet. Click Edit to add one.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT — animations + background tabs */}
      <aside className="flex h-full w-1/4 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <Tabs defaultValue="animations" className="flex h-full flex-col">
          <TabsList className="m-3 grid grid-cols-2">
            <TabsTrigger value="animations">Animations</TabsTrigger>
            <TabsTrigger value="background">Background</TabsTrigger>
          </TabsList>
          <TabsContent value="animations" className="m-0 min-h-0 flex-1 overflow-hidden border-t border-border">
            <div className="border-b border-border px-4 py-2">
              <p className="text-xs text-muted-foreground">
                {selectedWord ? `Searching "${selectedWord}"` : "Search, paste a URL, or upload"} · adds to Canvas {activeIdx + 1}
              </p>
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
          </TabsContent>
        </Tabs>
      </aside>

      <PlaybackDialog
        open={playOpen}
        onOpenChange={setPlayOpen}
        script={script}
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

function ClickableScript({
  text,
  selected,
  onWordClick,
}: {
  text: string;
  selected: string | null;
  onWordClick: (w: string) => void;
}) {
  const tokens = useMemo(() => {
    const out: { word: boolean; text: string }[] = [];
    let last = 0;
    for (const m of text.matchAll(WORD_RE)) {
      const idx = m.index ?? 0;
      if (idx > last) out.push({ word: false, text: text.slice(last, idx) });
      out.push({ word: true, text: m[0] });
      last = idx + m[0].length;
    }
    if (last < text.length) out.push({ word: false, text: text.slice(last) });
    return out;
  }, [text]);

  return (
    <p className="whitespace-pre-wrap">
      {tokens.map((t, i) =>
        t.word ? (
          <button
            key={i}
            onClick={() => onWordClick(t.text)}
            className={`rounded px-0.5 transition ${
              selected?.toLowerCase() === t.text.toLowerCase()
                ? "bg-primary/20 text-primary font-semibold"
                : "hover:bg-muted"
            }`}
          >
            {t.text}
          </button>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </p>
  );
}
