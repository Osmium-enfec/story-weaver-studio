import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Film, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProject } from "@/components/project-context";
import { DESIGN } from "@/lib/grid";
import { ExportSceneStage, type ExportSceneData, type ExportElement } from "@/components/ExportSceneStage";
import {
  exportScenesToBlob,
  convertWebmToMp4,
  QUALITY_PRESETS,
  type ExportQuality,
  type ExportFormat,
} from "@/lib/scene-exporter";

export const Route = createFileRoute("/projects/$projectId/export")({
  component: ExportPage,
});

interface SceneRow extends ExportSceneData {
  order_index: number;
  duration_ms: number;
  voice_url: string | null;
  voice_start_ms: number | null;
  voice_end_ms: number | null;
  voice_trim_start_ms: number;
  voice_trim_end_ms: number | null;
  voice_cuts: { start_ms: number; end_ms: number }[];
  voice_volume: number;
  voice_fade_in_ms: number;
  voice_fade_out_ms: number;
}

const DEFAULT_BG = { type: "color" as const, value: "#ffffff" };

function ExportPage() {
  const { projectId } = useParams({ from: "/projects/$projectId/export" });
  const { project } = useProject();
  const [scenes, setScenes] = useState<SceneRow[]>([]);
  const [scope, setScope] = useState<"all" | "select">("all");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [quality, setQuality] = useState<ExportQuality>("1080p");
  const [format, setFormat] = useState<ExportFormat>("webm");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<string>("");
  const [playingSceneId, setPlayingSceneId] = useState<string | null>(null);
  const [convertPct, setConvertPct] = useState<number | null>(null);
  const stageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const mountResolvers = useRef<Record<string, ((el: HTMLDivElement) => void) | null>>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  async function load() {
    const { data: rows, error } = await supabase
      .from("scenes")
      .select("id, order_index, background, duration_ms, voice_url, voice_start_ms, voice_end_ms, voice_trim_start_ms, voice_trim_end_ms, voice_cuts, voice_volume, voice_fade_in_ms, voice_fade_out_ms")
      .eq("project_id", projectId)
      .order("order_index");
    if (error) { toast.error(error.message); return; }
    const sceneIds = (rows ?? []).map((r) => r.id);
    const { data: els } = await supabase
      .from("scene_elements")
      .select("*")
      .in("scene_id", sceneIds)
      .order("z_index");
    const byScene = new Map<string, ExportElement[]>();
    for (const id of sceneIds) byScene.set(id, []);
    for (const e of (els ?? []) as unknown as ((ExportElement & { scene_id: string })[])) {
      byScene.get(e.scene_id)?.push(e);
    }
    const built: SceneRow[] = (rows ?? []).map((r) => {
      const bg = (r as unknown as { background: ExportSceneData["background"] | null }).background ?? DEFAULT_BG;
      return {
        id: r.id,
        order_index: r.order_index,
        background: bg,
        elements: byScene.get(r.id) ?? [],
        duration_ms: (r as unknown as { duration_ms: number }).duration_ms ?? 4000,
        voice_url: r.voice_url,
        voice_start_ms: r.voice_start_ms,
        voice_end_ms: r.voice_end_ms,
        voice_trim_start_ms: r.voice_trim_start_ms ?? 0,
        voice_trim_end_ms: r.voice_trim_end_ms,
        voice_cuts: (r.voice_cuts as { start_ms: number; end_ms: number }[]) ?? [],
        voice_volume: r.voice_volume ?? 1,
        voice_fade_in_ms: r.voice_fade_in_ms ?? 0,
        voice_fade_out_ms: r.voice_fade_out_ms ?? 0,
      };
    });
    setScenes(built);
    setPicked(Object.fromEntries(built.map((s) => [s.id, true])));
  }

  const selectedScenes = useMemo(() => {
    if (scope === "all") return scenes;
    return scenes.filter((s) => picked[s.id]);
  }, [scenes, picked, scope]);

  const totalDurationMs = useMemo(
    () => selectedScenes.reduce((s, sc) => s + sc.duration_ms, 0),
    [selectedScenes],
  );

  const estSeconds = useMemo(() => {
    // Heuristic: ~2× realtime for 1080p30, ~3× for 60fps, ~1.3× for 720p.
    const factor = quality === "1080p60" ? 3 : quality === "1080p" ? 2 : 1.3;
    const mp4Extra = format === "mp4" ? totalDurationMs * 0.5 : 0;
    return Math.round((totalDurationMs * factor + mp4Extra) / 1000);
  }, [totalDurationMs, quality, format]);

  async function runExport() {
    if (selectedScenes.length === 0) {
      toast.error("Pick at least one canvas to export");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      toast.error("This browser does not support video recording");
      return;
    }
    abortRef.current = new AbortController();
    setRunning(true);
    setProgress(0);
    setPhase("Initialising");
    try {
      // Wait one tick so the off-screen stages have mounted
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const exporterScenes = selectedScenes.map((s) => ({
        id: s.id,
        duration_ms: s.duration_ms,
        voice_url: s.voice_url,
        voice_start_ms: s.voice_start_ms,
        voice_end_ms: s.voice_end_ms,
        voice_trim_start_ms: s.voice_trim_start_ms,
        voice_trim_end_ms: s.voice_trim_end_ms,
        voice_cuts: s.voice_cuts,
        voice_volume: s.voice_volume,
        voice_fade_in_ms: s.voice_fade_in_ms,
        voice_fade_out_ms: s.voice_fade_out_ms,
        mount: () =>
          new Promise<HTMLElement>((resolve) => {
            const existing = stageRefs.current[s.id];
            if (existing) {
              resolve(existing);
              return;
            }
            mountResolvers.current[s.id] = (el) => resolve(el);
            setPlayingSceneId(s.id);
          }),
        unmount: () => {
          mountResolvers.current[s.id] = null;
          stageRefs.current[s.id] = null;
          setPlayingSceneId((cur) => (cur === s.id ? null : cur));
        },
      }));

      const webm = await exportScenesToBlob({
        scenes: exporterScenes,
        quality,
        format,
        includeAudio,
        signal: abortRef.current.signal,
        onPlayingScene: setPlayingSceneId,
        onProgress: ({ pct, phase }) => {
          setProgress(pct);
          setPhase(phase);
        },
      });

      let finalBlob = webm;
      let ext = "webm";
      if (format === "mp4") {
        setPhase("Converting to MP4");
        setConvertPct(0);
        try {
          finalBlob = await convertWebmToMp4(webm, (p) => setConvertPct(p));
          ext = "mp4";
        } catch (e) {
          console.error(e);
          toast.warning("MP4 conversion failed, downloading WebM instead");
        } finally {
          setConvertPct(null);
        }
      }

      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement("a");
      const baseName = (project.title || "code-motion").replace(/[^\w-]+/g, "-");
      const sceneSuffix =
        selectedScenes.length === 1 ? `-scene-${selectedScenes[0].order_index + 1}` : "";
      a.href = url;
      a.download = `${baseName}${sceneSuffix}-${quality}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success("Export complete");
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== "Aborted") {
        console.error(e);
        toast.error(msg);
      }
    } finally {
      setRunning(false);
      setPlayingSceneId(null);
      setProgress(0);
      setPhase("");
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Download className="h-6 w-6" /> Export
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Renders your canvases at full quality with synced voice. Takes longer
          than realtime — keep this tab open until it's done.
        </p>
      </div>

      <section className="rounded-lg border bg-card p-4 space-y-4">
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Scope</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant={scope === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setScope("all")}
              disabled={running}
            >
              Whole project ({scenes.length} canvas{scenes.length === 1 ? "" : "es"})
            </Button>
            <Button
              variant={scope === "select" ? "default" : "outline"}
              size="sm"
              onClick={() => setScope("select")}
              disabled={running}
            >
              Pick canvases
            </Button>
          </div>
          {scope === "select" && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {scenes.map((s) => {
                const on = !!picked[s.id];
                return (
                  <button
                    key={s.id}
                    onClick={() => setPicked((p) => ({ ...p, [s.id]: !on }))}
                    disabled={running}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      on ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50"
                    }`}
                  >
                    <span>Canvas {s.order_index + 1}</span>
                    {on ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Quality</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(QUALITY_PRESETS) as ExportQuality[]).map((q) => {
              const p = QUALITY_PRESETS[q];
              return (
                <Button
                  key={q}
                  variant={quality === q ? "default" : "outline"}
                  size="sm"
                  onClick={() => setQuality(q)}
                  disabled={running}
                >
                  {q} · {p.fps}fps
                </Button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Recommended: 1080p · 30fps. Use 1080p60 for very animated content.
          </p>
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Format</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant={format === "webm" ? "default" : "outline"}
              size="sm"
              onClick={() => setFormat("webm")}
              disabled={running}
            >
              WebM (faster)
            </Button>
            <Button
              variant={format === "mp4" ? "default" : "outline"}
              size="sm"
              onClick={() => setFormat("mp4")}
              disabled={running}
            >
              MP4 (universal)
            </Button>
          </div>
          {format === "mp4" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Adds an extra transcoding pass after recording (~30–60s).
            </p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Include voice audio</Label>
            <p className="text-xs text-muted-foreground">Mixes per-canvas voice with trims, cuts, fades.</p>
          </div>
          <Switch checked={includeAudio} onCheckedChange={setIncludeAudio} disabled={running} />
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <div className="text-sm text-muted-foreground">
            {selectedScenes.length} canvas{selectedScenes.length === 1 ? "" : "es"} ·{" "}
            {(totalDurationMs / 1000).toFixed(1)}s output · ~{estSeconds}s render time
          </div>
          {running ? (
            <Button variant="outline" onClick={cancel}>Cancel</Button>
          ) : (
            <Button onClick={runExport} disabled={selectedScenes.length === 0}>
              <Film className="mr-2 h-4 w-4" /> Start export
            </Button>
          )}
        </div>

        {running && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{phase || "Working…"}</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} />
            {convertPct != null && (
              <>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>MP4 transcode</span>
                  <span>{convertPct}%</span>
                </div>
                <Progress value={convertPct} />
              </>
            )}
          </div>
        )}
      </section>

      {/* Off-screen stages — one per selected scene, kept mounted so the
          exporter can snapshot them. We hide visually but stay in the layout
          tree (display:none breaks measurement, so we use absolute + opacity:0). */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: DESIGN.w,
          height: DESIGN.h,
          pointerEvents: "none",
          opacity: 0,
          zIndex: -1,
          overflow: "hidden",
        }}
      >
        {selectedScenes.map((s) => (
          <div
            key={s.id}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: DESIGN.w,
              height: DESIGN.h,
            }}
          >
            <ExportSceneStage
              ref={(el) => { stageRefs.current[s.id] = el; }}
              scene={s}
              isPlaying={playingSceneId === s.id}
            />
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: animated Lottie / video backgrounds are captured as a still frame.
        For text, images, icons and shapes the export matches the editor exactly.
      </p>
    </div>
  );
}
