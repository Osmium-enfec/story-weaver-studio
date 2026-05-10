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
import { Trash2, Plus, Eraser, Grid3x3, Minus } from "lucide-react";
import { toolbarStore } from "@/components/toolbar-store";
import { AnimationSearchPanel } from "@/components/AnimationSearchPanel";
import { AnimationBlockRenderer, TextBlockRenderer, measureTextSize, type AnimationBlockContent, type ShapeType } from "@/components/AnimationBlock";
import { BackgroundPicker, BackgroundLayer, type SceneBackground } from "@/components/BackgroundPicker";
import { ThemeBuilder } from "@/components/ThemeBuilder";
import { TextPanel, type TextRole, type TextRoleStyle } from "@/components/TextPanel";
import { ShapePanel } from "@/components/ShapePanel";
import type { FontPair } from "@/lib/font-pairs";
import type { BannerPreset } from "@/lib/banner-presets";
import { PlaybackDialog } from "@/components/PlaybackDialog";
import type { AnimationResult } from "@/lib/animation-providers";
import { cacheIconscoutItem } from "@/server/iconscout-mirror.functions";
import { seedAnimationsForProject } from "@/server/voice.functions";
import { proxyImageAsDataUrl } from "@/server/proxy-image.functions";
import { CanvasAudioEditor } from "@/components/CanvasAudioEditor";
import { applyPendingTheme, consumePendingTheme } from "@/lib/pending-theme";

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
  voice_url: string | null;
  voice_start_ms: number | null;
  voice_end_ms: number | null;
  word_timings: { text: string; start_ms: number; end_ms: number }[];
  voice_trim_start_ms: number;
  voice_trim_end_ms: number | null;
  voice_cuts: { start_ms: number; end_ms: number }[];
  voice_volume: number;
  voice_fade_in_ms: number;
  voice_fade_out_ms: number;
}

const DEFAULT_BG: SceneBackground = { type: "color", value: "#ffffff" };
import { DESIGN, cellRect, clampRectToDesign, nextEmptyCellIndex } from "@/lib/grid";
const DESIGN_CANVAS_SIZE = { w: DESIGN.w, h: DESIGN.h } as const;

function snapElementsToGrid(elements: PlacedElement[]): PlacedElement[] {
  // Only assign a grid cell to elements that don't have a saved position yet.
  // Preserve any user-edited positions already stored in the DB.
  return [...elements]
    .sort((a, b) => a.z_index - b.z_index)
    .map((element, index) => {
      const p = element.position;
      const hasPos =
        p && typeof p.w === "number" && typeof p.h === "number" && p.w > 0 && p.h > 0;
      return hasPos ? element : { ...element, position: cellRect(index) };
    });
}

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
  const canvasSize = DESIGN_CANVAS_SIZE;
  const [gridCanvases, setGridCanvases] = useState<Record<string, boolean>>({});
  const [canvasScales, setCanvasScales] = useState<Record<string, number>>({});
  const [rightTab, setRightTab] = useState<string>("animations");
  const [animationSubTab, setAnimationSubTab] = useState<string>("search");
  const [isSeeding, setIsSeeding] = useState(false);
  const [animPreview, setAnimPreview] = useState<{ id: string; tick: number } | null>(null);
  const animPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Click anywhere outside a selected element to deselect it
  useEffect(() => {
    if (!selectedElementId) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-canvas-element]")) return;
      if (target.closest("[data-keep-selection]")) return;
      setSelectedElementId(null);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [selectedElementId]);

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

  async function regenerateAnimations() {
    if (isSeeding) return;
    if (!confirm("Replace all canvas animations with fresh ones from your script keywords?")) return;
    setIsSeeding(true);
    try {
      const res = await seedAnimationsForProject({ data: { projectId, replace: true } });
      toast.success(`Added ${res.elementsInserted} animations across ${res.sceneCount} canvases`);
      // Refetch elements
      const { data: rows } = await supabase
        .from("scenes")
        .select("id")
        .eq("project_id", projectId);
      const ids = (rows ?? []).map((r) => r.id);
      const { data: els } = await supabase
        .from("scene_elements")
        .select("*")
        .in("scene_id", ids)
        .order("z_index");
      const byScene = new Map<string, PlacedElement[]>();
      for (const id of ids) byScene.set(id, []);
      for (const e of (els ?? []) as unknown as PlacedElement[]) byScene.get(e.scene_id)?.push(e);
      setScenes((prev) => prev.map((s) => ({ ...s, elements: snapElementsToGrid(byScene.get(s.id) ?? []) })));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIsSeeding(false);
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
          setPlayOpen(true);
        },
      },
      {
        label: isSeeding ? "Generating…" : "Auto-animate",
        icon: "play",
        variant: "outline",
        disabled: isSeeding || isExporting,
        onClick: regenerateAnimations,
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
  }, [isPlaying, isExporting, isSeeding, activeScene?.id]);

  // Load all scenes + their elements
  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase
        .from("scenes")
        .select("id, order_index, background, narration, voice_url, voice_start_ms, voice_end_ms, word_timings, voice_trim_start_ms, voice_trim_end_ms, voice_cuts, voice_volume, voice_fade_in_ms, voice_fade_out_ms")
        .eq("project_id", projectId)
        .order("order_index");
      let sceneRows = (rows ?? []) as {
        id: string;
        order_index: number;
        background: SceneBackground | null;
        narration: string | null;
        voice_url: string | null;
        voice_start_ms: number | null;
        voice_end_ms: number | null;
        word_timings: { text: string; start_ms: number; end_ms: number }[] | null;
        voice_trim_start_ms: number | null;
        voice_trim_end_ms: number | null;
        voice_cuts: { start_ms: number; end_ms: number }[] | null;
        voice_volume: number | null;
        voice_fade_in_ms: number | null;
        voice_fade_out_ms: number | null;
      }[];

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
          .select("id, order_index, background, narration, voice_url, voice_start_ms, voice_end_ms, word_timings, voice_trim_start_ms, voice_trim_end_ms, voice_cuts, voice_volume, voice_fade_in_ms, voice_fade_out_ms")
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
          elements: snapElementsToGrid(byScene.get(s.id) ?? []),
          voice_url: s.voice_url,
          voice_start_ms: s.voice_start_ms,
          voice_end_ms: s.voice_end_ms,
          word_timings: s.word_timings ?? [],
          voice_trim_start_ms: s.voice_trim_start_ms ?? 0,
          voice_trim_end_ms: s.voice_trim_end_ms,
          voice_cuts: s.voice_cuts ?? [],
          voice_volume: s.voice_volume ?? 1,
          voice_fade_in_ms: s.voice_fade_in_ms ?? 0,
          voice_fade_out_ms: s.voice_fade_out_ms ?? 0,
        })),
      );
      setActiveIdx(0);
    })();
  }, [projectId]);

  // Realtime: pick up newly-seeded scene_elements (auto-animate / transcribe seed)
  useEffect(() => {
    const sceneIds = scenes.map((s) => s.id);
    if (sceneIds.length === 0) return;
    const channel = supabase
      .channel(`scene_elements_${projectId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "scene_elements" },
        (payload) => {
          const row = payload.new as unknown as PlacedElement;
          if (!sceneIds.includes(row.scene_id)) return;
          setScenes((prev) =>
            prev.map((s) =>
              s.id === row.scene_id && !s.elements.find((e) => e.id === row.id)
                ? { ...s, elements: [...s.elements, row] }
                : s,
            ),
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, scenes.length]);

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
      {
        id: r.id,
        order_index: r.order_index,
        background: r.background ?? DEFAULT_BG,
        narration: r.narration ?? "",
        elements: [],
        voice_url: null,
        voice_start_ms: null,
        voice_end_ms: null,
        word_timings: [],
        voice_trim_start_ms: 0,
        voice_trim_end_ms: null,
        voice_cuts: [],
        voice_volume: 1,
        voice_fade_in_ms: 0,
        voice_fade_out_ms: 0,
      },
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
    if (!selectedWord) {
      toast.error("Click + next to a word in the script first");
      return;
    }
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

    const cellIdx = nextEmptyCellIndex(activeScene.elements.map((e) => e.position));
    const { x, y, w, h } = cellRect(cellIdx);

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
      remove_background: a.provider === "iconscout",
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
    setRightTab("text");
  }

  async function addTextBlock(role: TextRole, style: TextRoleStyle, overrideText?: string) {
    if (!activeScene) return;
    const node = canvasRefs.current[activeScene.id];
    if (!node) return;
    const cellIdx = nextEmptyCellIndex(activeScene.elements.map((e) => e.position));
    const cell = cellRect(cellIdx);
    const placeholder = role === "heading" ? "Add a heading" : role === "subheading" ? "Add a subheading" : "Add a little bit of body text";
    const textValue = overrideText ?? selectedWord ?? placeholder;
    const natural = measureTextSize(textValue, {
      fontFamily: style.family,
      fontSize: style.size,
      fontWeight: style.weight,
      lineHeight: style.lineHeight,
    });
    const x = cell.x;
    const y = cell.y;
    const w = Math.min(natural.w, cell.w);
    const h = Math.min(natural.h, cell.h);
    const content: AnimationBlockContent = {
      provider: "internal",
      name: role,
      role,
      text: textValue,
      font_family: style.family,
      font_size: style.size,
      font_weight: style.weight,
      line_height: style.lineHeight,
      color: style.color,
      opacity: 1,
      rotation: 0,
      word: selectedWord,
      occurrence: selectedWord
        ? activeScene.elements.filter((e) => (e.content.word ?? "").toLowerCase() === selectedWord.toLowerCase()).length + 1
        : null,
    };
    const { data, error } = await supabase
      .from("scene_elements")
      .insert({
        scene_id: activeScene.id,
        type: "text",
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

  async function addFontPair(pair: FontPair) {
    if (!activeScene) return;
    const node = canvasRefs.current[activeScene.id];
    if (!node) return;
    // Place heading + body stacked in two adjacent cells.
    const used = activeScene.elements.map((e) => e.position);
    const headingCell = cellRect(nextEmptyCellIndex(used));
    const bodyCell = cellRect(nextEmptyCellIndex([...used, headingCell]));

    const items: { text: string; size: number; cell: { x: number; y: number; w: number; h: number }; cfg: FontPair["heading"] | FontPair["body"]; role: TextRole }[] = [
      { text: pair.label,  size: 56, cell: headingCell, cfg: pair.heading, role: "heading" },
      { text: pair.vibe,   size: 22, cell: bodyCell,    cfg: pair.body,    role: "subheading" },
    ];

    for (const it of items) {
      const natural = measureTextSize(it.text, {
        fontFamily: it.cfg.family, fontSize: it.size, fontWeight: it.cfg.weight, lineHeight: 1.2,
      });
      const w = Math.min(natural.w, it.cell.w);
      const h = Math.min(natural.h, it.cell.h);
      const content: AnimationBlockContent = {
        provider: "internal",
        name: it.role,
        role: it.role,
        text: it.text,
        font_family: it.cfg.family,
        font_size: it.size,
        font_weight: it.cfg.weight,
        line_height: 1.2,
        color: it.cfg.color,
        italic: it.cfg.italic,
        letter_spacing: it.cfg.letterSpacing,
        text_transform: it.cfg.transform === "uppercase" ? "uppercase" : "none",
        opacity: 1,
        rotation: 0,
        word: null,
        occurrence: null,
      };
      const { data, error } = await supabase
        .from("scene_elements")
        .insert({
          scene_id: activeScene.id,
          type: "text",
          content: content as unknown as never,
          position: { x: it.cell.x, y: it.cell.y, w, h },
          z_index: activeScene.elements.length,
        })
        .select("*")
        .single();
      if (error) { toast.error(error.message); return; }
      const newEl = data as unknown as PlacedElement;
      setScenes((prev) => prev.map((s) => (s.id === activeScene.id ? { ...s, elements: [...s.elements, newEl] } : s)));
    }
    toast.success(`Added "${pair.label}" font pair`);
  }

  async function addBanner(preset: BannerPreset) {
    if (!activeScene) return;
    const used = activeScene.elements.map((e) => e.position);
    const cell = cellRect(nextEmptyCellIndex(used));
    const fontSize = 56;
    const natural = measureTextSize(preset.label, {
      fontFamily: preset.font_family, fontSize, fontWeight: preset.font_weight, lineHeight: 1.1,
    });
    const padX = preset.padding_x ?? 28;
    const padY = preset.padding_y ?? 14;
    const w = Math.min(natural.w + padX * 2 + 16, cell.w);
    const h = Math.min(natural.h + padY * 2 + 16, cell.h);
    const x = cell.x + Math.round((cell.w - w) / 2);
    const y = cell.y + Math.round((cell.h - h) / 2);
    const content: AnimationBlockContent = {
      provider: "internal",
      name: "banner",
      role: "heading",
      text: preset.label,
      font_family: preset.font_family,
      font_size: fontSize,
      font_weight: preset.font_weight,
      line_height: 1.1,
      color: preset.text_color,
      italic: preset.italic,
      letter_spacing: preset.letter_spacing,
      text_transform: preset.transform === "uppercase" ? "uppercase" : "none",
      opacity: 1,
      rotation: 0,
      word: null,
      occurrence: null,
      text_bg_color: preset.bg_color,
      text_bg_padding_x: padX,
      text_bg_padding_y: padY,
      text_bg_radius: preset.radius,
      text_bg_border_color: preset.border_color ?? null,
      text_bg_border_width: preset.border_width,
    };
    const { data, error } = await supabase
      .from("scene_elements")
      .insert({
        scene_id: activeScene.id,
        type: "text",
        content: content as unknown as never,
        position: { x, y, w, h },
        z_index: activeScene.elements.length,
      })
      .select("*")
      .single();
    if (error) { toast.error(error.message); return; }
    const newEl = data as unknown as PlacedElement;
    setScenes((prev) => prev.map((s) => (s.id === activeScene.id ? { ...s, elements: [...s.elements, newEl] } : s)));
    setSelectedElementId(newEl.id);
    toast.success(`Added "${preset.label}" banner`);
  }

  async function addShape(shape: ShapeType) {
    if (!activeScene) return;
    const used = activeScene.elements.map((e) => e.position);
    const cell = cellRect(nextEmptyCellIndex(used));
    const isLine = shape.includes("line") || shape.startsWith("arrow");
    const position = isLine
      ? { x: cell.x + 36, y: cell.y + Math.round(cell.h / 2) - 18, w: Math.max(180, cell.w - 72), h: 36 }
      : { x: cell.x + Math.round((cell.w - 140) / 2), y: cell.y + Math.round((cell.h - 140) / 2), w: 140, h: 140 };
    const content: AnimationBlockContent = {
      provider: "internal",
      name: shape.replace(/-/g, " "),
      shape_type: shape,
      color: "#111827",
      tint: "#111827",
      color_support: "custom",
      opacity: 1,
      rotation: 0,
      shape_stroke_width: 7,
    };
    const { data, error } = await supabase
      .from("scene_elements")
      .insert({
        scene_id: activeScene.id,
        type: "shape",
        content: content as unknown as never,
        position: clampRectToDesign(position) as unknown as never,
        z_index: activeScene.elements.length,
      })
      .select("*")
      .single();
    if (error) { toast.error(error.message); return; }
    const newEl = data as unknown as PlacedElement;
    setScenes((prev) => prev.map((s) => (s.id === activeScene.id ? { ...s, elements: [...s.elements, newEl] } : s)));
    setSelectedElementId(newEl.id);
    setRightTab("animations");
    setAnimationSubTab("shape-edit");
  }

  async function updateElementAnimation(sceneId: string, id: string, anim: AnimationBlockContent["text_animation"]) {
    await updateElementContent(sceneId, id, { text_animation: anim });
    // Trigger a one-shot preview on the canvas so the user sees the animation immediately.
    setAnimPreview((p) => ({ id, tick: (p?.id === id ? p.tick : 0) + 1 }));
    if (animPreviewTimer.current) clearTimeout(animPreviewTimer.current);
    const total = (anim?.duration ?? 600) + (anim?.delay ?? 0) + 200;
    animPreviewTimer.current = setTimeout(() => setAnimPreview(null), total);
  }

  async function updateElementContent(sceneId: string, id: string, patch: Partial<AnimationBlockContent>) {
    const current = scenes.find((s) => s.id === sceneId)?.elements.find((e) => e.id === id);
    if (!current) return;
    const nextContent: AnimationBlockContent = { ...current.content, ...patch };
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              elements: s.elements.map((e) => {
                if (e.id !== id) return e;
                return { ...e, content: nextContent };
              }),
            }
          : s,
      ),
    );
    await supabase.from("scene_elements").update({ content: nextContent as unknown as never }).eq("id", id);
  }

  async function updateElementText(sceneId: string, id: string, text: string) {
    let nextContent: AnimationBlockContent | null = null;
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              elements: s.elements.map((e) => {
                if (e.id !== id) return e;
                nextContent = { ...e.content, text };
                return { ...e, content: nextContent };
              }),
            }
          : s,
      ),
    );
    if (nextContent) {
      await supabase.from("scene_elements").update({ content: nextContent as unknown as never }).eq("id", id);
    }
  }

  async function updateElement(sceneId: string, id: string, position: PlacedElement["position"]) {
    const safePosition = clampRectToDesign(position);
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId ? { ...s, elements: s.elements.map((e) => (e.id === id ? { ...e, position: safePosition } : e)) } : s,
      ),
    );
    await supabase.from("scene_elements").update({ position: safePosition as unknown as never }).eq("id", id);
  }

  async function deleteElement(sceneId: string, id: string) {
    const scene = scenes.find((s) => s.id === sceneId);
    const remaining = scene ? scene.elements.filter((e) => e.id !== id).map((e, i) => ({ ...e, z_index: i })) : [];
    setScenes((prev) =>
      prev.map((s) => (s.id === sceneId ? { ...s, elements: remaining } : s)),
    );
    await supabase.from("scene_elements").delete().eq("id", id);
    await Promise.all(
      remaining.map((e) => supabase.from("scene_elements").update({ z_index: e.z_index }).eq("id", e.id)),
    );
  }

  async function reorderElements(sceneId: string, orderedIds: string[]) {
    const scene = scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const byId = new Map(scene.elements.map((e) => [e.id, e]));
    const next = orderedIds.map((id, i) => {
      const el = byId.get(id)!;
      return { ...el, z_index: i };
    });
    setScenes((prev) => prev.map((s) => (s.id === sceneId ? { ...s, elements: next } : s)));
    await Promise.all(
      next.map((e) => supabase.from("scene_elements").update({ z_index: e.z_index }).eq("id", e.id)),
    );
  }

  async function toggleElementBackground(sceneId: string, id: string) {
    let nextContent: AnimationBlockContent | null = null;
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              elements: s.elements.map((e) => {
                if (e.id !== id) return e;
                const updated = { ...e.content, remove_background: !e.content.remove_background };
                nextContent = updated;
                return { ...e, content: updated };
              }),
            }
          : s,
      ),
    );
    if (nextContent) {
      await supabase
        .from("scene_elements")
        .update({ content: nextContent as unknown as never })
        .eq("id", id);
    }
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
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className={`h-7 gap-1 text-xs ${gridCanvases[s.id] ? "text-primary" : ""}`}
                  onClick={(e) => { e.stopPropagation(); setGridCanvases((p) => ({ ...p, [s.id]: !p[s.id] })); }}
                  title="Toggle 3×3 grid"
                >
                  <Grid3x3 className="h-3 w-3" />
                </Button>
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
            </div>
             <div className="flex justify-center bg-muted/30 p-4">
              <div
                ref={(el) => { canvasRefs.current[s.id] = el; }}
                className="relative w-full overflow-hidden rounded-xl bg-white shadow-md"
                style={{ aspectRatio: `${DESIGN.w} / ${DESIGN.h}` }}
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) setSelectedElementId(null);
                }}
              >
                <div
                  className="absolute left-1/2 top-1/2 origin-center"
                  style={{ width: DESIGN.w, height: DESIGN.h }}
                  ref={(node) => {
                    if (!node) return;
                    const parent = node.parentElement as HTMLElement | null;
                    if (!parent) return;
                    const apply = () => {
                      const sc = Math.min(parent.clientWidth / DESIGN.w, parent.clientHeight / DESIGN.h);
                      node.style.transform = `translate(-50%, -50%) scale(${sc})`;
                      setCanvasScales((prev) => (prev[s.id] === sc ? prev : { ...prev, [s.id]: sc }));
                    };
                    apply();
                    const ro = new ResizeObserver(apply);
                    ro.observe(parent);
                  }}
                >
                  <BackgroundLayer background={s.background} exportMode={isExporting} />
                  {gridCanvases[s.id] && (
                    <div className="pointer-events-none absolute inset-0 z-10 grid grid-cols-3 grid-rows-3">
                      {Array.from({ length: 9 }).map((_, i) => (
                        <div key={i} className="border border-primary/40" />
                      ))}
                    </div>
                  )}
                {s.elements.map((el) => (
                  <Rnd
                    key={el.id}
                    bounds="parent"
                    scale={canvasScales[s.id] ?? 1}
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
                    onMouseDown={() => {
                      setActiveIdx(idx);
                      setSelectedElementId(el.id);
                      if (el.type === "text") setRightTab("text");
                      if (el.type === "shape") { setRightTab("animations"); setAnimationSubTab("shape-edit"); }
                    }}
                    className={`group/el rounded-lg border-2 ${
                      selectedElementId === el.id ? "border-primary" : "border-transparent hover:border-primary/40"
                    }`}
                    data-canvas-element="true"
                  >
                    <div className={`relative h-full w-full overflow-hidden ${isPlaying ? "animate-fade-in" : ""}`}>
                      {el.content.word && (
                        <span className="pointer-events-none absolute -left-2 -top-2 z-20 flex h-5 items-center gap-0.5 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-foreground shadow">
                          🔗 {el.content.word}
                        </span>
                      )}
                      {el.type === "text" ? (
                        <TextBlockRenderer
                          key={animPreview?.id === el.id ? `anim-${animPreview.tick}` : "static"}
                          content={el.content}
                          editable={selectedElementId === el.id}
                          animating={isPlaying || animPreview?.id === el.id}
                          onChange={(text) => void updateElementText(s.id, el.id, text)}
                        />
                      ) : (
                        <AnimationBlockRenderer content={el.content} exportMode={isExporting} />
                      )}
                      {selectedElementId === el.id && (
                        <>
                          {el.type !== "text" && (
                            <button
                              onClick={(e) => { e.stopPropagation(); void toggleElementBackground(s.id, el.id); }}
                              title={el.content.remove_background ? "Restore background" : "Remove background"}
                              className={`absolute right-6 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full shadow ${
                                el.content.remove_background
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-card text-foreground border border-border"
                              }`}
                            >
                              <Eraser className="h-3 w-3" />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteElement(s.id, el.id); }}
                            title="Delete"
                            className="absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </Rnd>
                ))}
                </div>
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
                    elements={s.elements}
                    onWordSelect={(w) => { setActiveIdx(idx); setSelectedWord(w); }}
                    onAddForWord={(w) => {
                      setActiveIdx(idx);
                      setSelectedWord(w);
                      setRightTab("animations");
                      setAnimationSubTab("search");
                    }}
                    onRemoveForWord={(w) => {
                      const lower = w.toLowerCase();
                      const targets = s.elements.filter((e) => (e.content.word ?? "").toLowerCase() === lower);
                      targets.forEach((t) => void deleteElement(s.id, t.id));
                    }}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No script yet. Click Edit to add one.</p>
              )}
            </div>
            <CanvasAudioEditor
              sceneId={s.id}
              projectId={projectId}
              state={{
                voice_url: s.voice_url,
                voice_start_ms: s.voice_start_ms,
                voice_end_ms: s.voice_end_ms,
                voice_trim_start_ms: s.voice_trim_start_ms,
                voice_trim_end_ms: s.voice_trim_end_ms,
                voice_cuts: s.voice_cuts,
                voice_volume: s.voice_volume,
                voice_fade_in_ms: s.voice_fade_in_ms,
                voice_fade_out_ms: s.voice_fade_out_ms,
              }}
              onChange={(patch) =>
                setScenes((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...patch } : x)))
              }
            />
          </div>
        ))}
        <Button variant="outline" className="w-full gap-1.5" onClick={addCanvas}>
          <Plus className="h-4 w-4" /> Add canvas
        </Button>
      </div>

      {/* RIGHT — animations + background tabs (sticky) */}
      <aside className="w-1/4">
        <div
          className="sticky flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          style={{ top: "4.5rem", height: "calc(100vh - 5.5rem)" }}
        >
          <Tabs value={rightTab} onValueChange={setRightTab} className="flex h-full min-h-0 flex-col">
            <TabsList className="m-3 grid shrink-0 grid-cols-4">
              <TabsTrigger value="animations" className="text-[11px]">Anim</TabsTrigger>
              <TabsTrigger value="background" className="text-[11px]">BG</TabsTrigger>
              <TabsTrigger value="text" className="text-[11px]">Text</TabsTrigger>
              <TabsTrigger value="theme" className="text-[11px]">Theme</TabsTrigger>
            </TabsList>
            <TabsContent value="animations" className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
              <Tabs value={animationSubTab} onValueChange={setAnimationSubTab} className="flex h-full min-h-0 flex-col">
                <TabsList className="m-3 grid shrink-0 grid-cols-3">
                  <TabsTrigger value="search" className="text-[11px]">Search</TabsTrigger>
                  <TabsTrigger value="shapes" className="text-[11px]">Shapes</TabsTrigger>
                  <TabsTrigger value="shape-edit" className="text-[11px]">Edit</TabsTrigger>
                </TabsList>
                <TabsContent value="search" className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
                  <div className="shrink-0 border-b border-border px-4 py-2">
                    <p className="text-xs text-muted-foreground">
                      {selectedWord
                        ? <>Adding to word · <span className="font-semibold text-primary">{selectedWord}</span></>
                        : "Click + next to a word in the script first"}
                    </p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <AnimationSearchPanel initialQuery={selectedWord ?? ""} onSelect={addAnimation} />
                  </div>
                </TabsContent>
                <TabsContent value="shapes" className="m-0 min-h-0 flex-1 overflow-y-auto border-t border-border">
                  <ShapePanel mode="insert" onInsertShape={(shape) => void addShape(shape)} />
                </TabsContent>
                <TabsContent value="shape-edit" className="m-0 min-h-0 flex-1 overflow-y-auto border-t border-border">
                  {(() => {
                    const sel = activeScene?.elements.find((e) => e.id === selectedElementId && e.type === "shape");
                    return (
                      <ShapePanel
                        mode="edit"
                        selectedShapeContent={sel?.content}
                        selectedShapeSize={sel?.position ? { w: sel.position.w, h: sel.position.h } : undefined}
                        onInsertShape={(shape) => void addShape(shape)}
                        onChangeSelectedShape={sel ? (patch) => void updateElementContent(activeScene!.id, sel.id, patch) : undefined}
                        onChangeSelectedShapeSize={sel ? (size) => void updateElement(activeScene!.id, sel.id, { ...sel.position, ...size }) : undefined}
                      />
                    );
                  })()}
                </TabsContent>
              </Tabs>
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
            <TabsContent value="text" className="m-0 min-h-0 flex-1 overflow-y-auto border-t border-border">
              {(() => {
                const sel = activeScene?.elements.find((e) => e.id === selectedElementId && e.type === "text");
                return (
                  <TextPanel
                    onInsert={(role, style, text) => void addTextBlock(role, style, text)}
                    onInsertPair={(pair) => void addFontPair(pair)}
                    onInsertBanner={(preset) => void addBanner(preset)}
                    selectedTextContent={sel?.content}
                    onChangeSelectedAnimation={sel ? (v) => void updateElementAnimation(activeScene!.id, sel.id, v) : undefined}
                    onChangeSelectedText={sel ? (patch) => void updateElementContent(activeScene!.id, sel.id, patch) : undefined}
                  />
                );
              })()}
            </TabsContent>
            <TabsContent value="theme" className="m-0 min-h-0 flex-1 overflow-hidden border-t border-border">
              <ThemeBuilder
                onApplyBackground={(bg) => void updateBackground(bg, true)}
                onInsertText={(role, style) => void addTextBlock(role, style)}
                onApplyColor={(hex) => {
                  if (!activeScene || !selectedElementId) {
                    toast.message("Select a text or shape first to apply this color.");
                    return;
                  }
                  const el = activeScene.elements.find((e) => e.id === selectedElementId);
                  if (!el) return;
                  const patch: Partial<AnimationBlockContent> =
                    el.type === "shape"
                      ? { color: hex, tint: hex }
                      : { color: hex };
                  void updateElementContent(activeScene.id, el.id, patch);
                }}
                onInsertMedia={(item) => {
                  const isLottie = item.kind === "animation" || /\.(lottie|json)$/i.test(item.name);
                  const isVideo = item.kind === "video";
                  void addAnimation({
                    id: `theme:${item.url}`,
                    provider: isLottie ? "lottie" : isVideo ? "iconscout" : "image",
                    name: item.name,
                    tags: [],
                    concepts: [],
                    lottie_url: isLottie ? item.url : null,
                    thumbnail_url: !isLottie ? item.url : null,
                    video_url: !isLottie ? item.url : null,
                    color_support: "theme",
                  });
                }}
              />
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
          narration: s.narration,
          voice_url: s.voice_url,
          voice_start_ms: s.voice_start_ms,
          voice_end_ms: s.voice_end_ms,
          word_timings: s.word_timings,
          voice_trim_start_ms: s.voice_trim_start_ms,
          voice_trim_end_ms: s.voice_trim_end_ms,
          voice_cuts: s.voice_cuts,
          voice_volume: s.voice_volume,
          voice_fade_in_ms: s.voice_fade_in_ms,
          voice_fade_out_ms: s.voice_fade_out_ms,
          elements: s.elements.map((e) => ({
            id: e.id,
            type: e.type,
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
  elements,
  onWordSelect,
  onAddForWord,
  onRemoveForWord,
}: {
  text: string;
  selected: string | null;
  elements: PlacedElement[];
  onWordSelect: (w: string) => void;
  onAddForWord: (w: string) => void;
  onRemoveForWord: (w: string) => void;
}) {
  const boundCounts = new Map<string, number>();
  for (const el of elements) {
    const w = (el.content.word ?? "").toLowerCase();
    if (!w) continue;
    boundCounts.set(w, (boundCounts.get(w) ?? 0) + 1);
  }

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
    <p className="whitespace-pre-wrap leading-9">
      {tokens.map((t, i) => {
        if (!t.word) return <span key={i}>{t.text}</span>;
        const lower = t.text.toLowerCase();
        const isSelected = selected?.toLowerCase() === lower;
        const count = boundCounts.get(lower) ?? 0;
        const isBound = count > 0;
        return (
          <span key={i} className="inline-flex items-center gap-0.5 align-baseline">
            <button
              onClick={(e) => { e.stopPropagation(); onWordSelect(t.text); }}
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
            {isBound ? (
              <button
                title={`Remove ${count} animation${count > 1 ? "s" : ""}`}
                onClick={(e) => { e.stopPropagation(); onRemoveForWord(t.text); }}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:scale-110 transition"
              >
                <Minus className="h-2.5 w-2.5" />
              </button>
            ) : (
              <button
                title="Add animation for this word"
                onClick={(e) => { e.stopPropagation(); onAddForWord(t.text); }}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm opacity-60 hover:opacity-100 hover:scale-110 transition"
              >
                <Plus className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        );
      })}
    </p>
  );
}
