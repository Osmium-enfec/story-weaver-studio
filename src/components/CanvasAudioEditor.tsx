import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Play, Pause, Scissors, RotateCcw, Trash2, Mic, Upload, Loader2, Volume2, ChevronDown, ChevronUp,
} from "lucide-react";
import { transcribeClip } from "@/server/voice.functions";

export interface CanvasAudioState {
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

interface Props {
  sceneId: string;
  projectId: string;
  state: CanvasAudioState;
  onChange: (next: Partial<CanvasAudioState> & { narration?: string; word_timings?: { text: string; start_ms: number; end_ms: number }[] }) => void;
}

const ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/x-m4a,audio/webm";

export function CanvasAudioEditor({ sceneId, projectId, state, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const [open, setOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [busy, setBusy] = useState<string>("");
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Segment-relative duration in seconds (this canvas's clip)
  const segDurSec =
    state.voice_url && state.voice_end_ms != null && state.voice_start_ms != null
      ? Math.max(0.1, (state.voice_end_ms - state.voice_start_ms) / 1000)
      : 0;

  // Initialize wavesurfer when opened
  useEffect(() => {
    if (!open || !containerRef.current || !state.voice_url) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "hsl(var(--muted-foreground) / 0.5)",
      progressColor: "hsl(var(--primary))",
      cursorColor: "hsl(var(--primary))",
      height: 64,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
    });
    wsRef.current = ws;
    setIsReady(false);
    ws.load(state.voice_url);
    ws.on("ready", () => setIsReady(true));
    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => setIsPlaying(false));
    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [open, state.voice_url]);

  // Apply volume changes live
  useEffect(() => {
    wsRef.current?.setVolume(Math.max(0, Math.min(2, state.voice_volume)));
  }, [state.voice_volume]);

  const persist = useCallback(
    async (patch: Partial<CanvasAudioState>) => {
      onChange(patch);
      const { error } = await supabase.from("scenes").update(patch as never).eq("id", sceneId);
      if (error) toast.error(error.message);
    },
    [sceneId, onChange],
  );

  function togglePlay() {
    const ws = wsRef.current;
    if (!ws) return;
    if (ws.isPlaying()) ws.pause();
    else {
      // Start at trim_start within the segment
      const trimStartSec = state.voice_trim_start_ms / 1000;
      ws.setTime(trimStartSec);
      ws.play();
    }
  }

  function setTrimStart() {
    const ws = wsRef.current;
    if (!ws) return;
    const ms = Math.round(ws.getCurrentTime() * 1000);
    void persist({ voice_trim_start_ms: ms });
    toast.success(`Trim in: ${formatMs(ms)}`);
  }

  function setTrimEnd() {
    const ws = wsRef.current;
    if (!ws) return;
    const ms = Math.round(ws.getCurrentTime() * 1000);
    void persist({ voice_trim_end_ms: ms });
    toast.success(`Trim out: ${formatMs(ms)}`);
  }

  function resetTrim() {
    void persist({ voice_trim_start_ms: 0, voice_trim_end_ms: null });
  }

  // Cuts: capture two playhead positions
  const [cutStart, setCutStart] = useState<number | null>(null);
  function handleCut() {
    const ws = wsRef.current;
    if (!ws) return;
    const ms = Math.round(ws.getCurrentTime() * 1000);
    if (cutStart == null) {
      setCutStart(ms);
      toast.message("Cut start set. Move playhead and click Cut again to finish.");
      return;
    }
    const a = Math.min(cutStart, ms);
    const b = Math.max(cutStart, ms);
    if (b - a < 50) {
      toast.error("Cut region too small");
      setCutStart(null);
      return;
    }
    const next = [...state.voice_cuts, { start_ms: a, end_ms: b }].sort((x, y) => x.start_ms - y.start_ms);
    void persist({ voice_cuts: next });
    setCutStart(null);
  }

  function clearCuts() {
    void persist({ voice_cuts: [] });
  }

  async function deleteAudio() {
    if (!confirm("Remove audio from this canvas? Word-timed animations will lose their sync.")) return;
    await persist({
      voice_url: null,
      voice_start_ms: null,
      voice_end_ms: null,
      voice_trim_start_ms: 0,
      voice_trim_end_ms: null,
      voice_cuts: [],
    });
    onChange({ word_timings: [] });
    await supabase.from("scenes").update({ word_timings: [] as unknown as never }).eq("id", sceneId);
  }

  async function uploadFile(file: File) {
    if (file.size > 25 * 1024 * 1024) return toast.error("Max 25MB");
    setBusy("Uploading…");
    try {
      const ext = (file.name.split(".").pop() || "webm").toLowerCase();
      const path = `${projectId}/scene-${sceneId}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("voice-uploads")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("voice-uploads").getPublicUrl(path);
      setBusy("Transcribing…");
      const res = await transcribeClip({
        data: { sceneId, voiceUrl: pub.publicUrl, storagePath: path },
      });
      onChange({
        voice_url: pub.publicUrl,
        voice_start_ms: 0,
        voice_end_ms: res.durationMs,
        voice_trim_start_ms: 0,
        voice_trim_end_ms: null,
        voice_cuts: [],
        word_timings: [],
      });
      // Force re-fetch of word timings via parent — easiest: ask parent to refresh
      // We trigger by setting word_timings to [] then onChange will pick up next reload.
      toast.success("Audio replaced & re-synced");
      // Tell parent the new narration / timings will be reloaded on next page mount.
      // Best UX: refresh in place by reloading scene row.
      const { data: row } = await supabase
        .from("scenes")
        .select("narration, word_timings")
        .eq("id", sceneId)
        .single();
      if (row) {
        onChange({
          word_timings: (row.word_timings as { text: string; start_ms: number; end_ms: number }[]) ?? [],
        });
        // narration is also returned via the union type
        onChange({ narration: (row as { narration: string }).narration } as Partial<CanvasAudioState> & { narration: string });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recChunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && recChunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recChunksRef.current, { type: mime });
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: mime });
        await uploadFile(file);
      };
      mediaRecRef.current = rec;
      rec.start();
      setRecording(true);
      setRecMs(0);
      const startedAt = Date.now();
      recTimerRef.current = setInterval(() => setRecMs(Date.now() - startedAt), 100);
    } catch (e) {
      toast.error("Microphone access denied");
    }
  }

  function stopRecording() {
    mediaRecRef.current?.stop();
    setRecording(false);
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
  }

  if (!state.voice_url) {
    return (
      <div className="border-t border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Audio
          </Label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={!!busy || recording}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload
          </Button>
          {recording ? (
            <Button size="sm" variant="destructive" onClick={stopRecording}>
              <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
              Stop {formatMs(recMs)}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={startRecording} disabled={!!busy}>
              <Mic className="mr-1.5 h-3.5 w-3.5" /> Record
            </Button>
          )}
          {busy && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> {busy}
            </span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadFile(f);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  const trimEndMs = state.voice_trim_end_ms ?? Math.round(segDurSec * 1000);
  return (
    <div className="border-t border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 hover:bg-muted/50"
      >
        <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Volume2 className="h-3.5 w-3.5" /> Audio · {formatMs(trimEndMs - state.voice_trim_start_ms)}
          {state.voice_cuts.length > 0 && (
            <span className="rounded bg-destructive/20 px-1.5 py-0.5 text-[9px] text-destructive">
              {state.voice_cuts.length} cut{state.voice_cuts.length > 1 ? "s" : ""}
            </span>
          )}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="space-y-3 p-3">
          <div ref={containerRef} className="rounded-md bg-muted/40 p-2" />

          {/* Trim & cuts overlay info */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>In: {formatMs(state.voice_trim_start_ms)}</span>
            <span>·</span>
            <span>Out: {formatMs(trimEndMs)}</span>
            {state.voice_cuts.length > 0 && (
              <>
                <span>·</span>
                <span>Cuts: {state.voice_cuts.map((c) => `${formatMs(c.start_ms)}-${formatMs(c.end_ms)}`).join(", ")}</span>
              </>
            )}
          </div>

          {/* Transport */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={togglePlay} disabled={!isReady}>
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="outline" onClick={setTrimStart} disabled={!isReady}>
              ⟦ Set in
            </Button>
            <Button size="sm" variant="outline" onClick={setTrimEnd} disabled={!isReady}>
              Set out ⟧
            </Button>
            <Button size="sm" variant="outline" onClick={resetTrim} disabled={!isReady}>
              <RotateCcw className="mr-1 h-3 w-3" /> Reset trim
            </Button>
            <Button size="sm" variant={cutStart != null ? "default" : "outline"} onClick={handleCut} disabled={!isReady}>
              <Scissors className="mr-1 h-3 w-3" />
              {cutStart != null ? `Cut end @ ${formatMs(cutStart)}…` : "Cut"}
            </Button>
            {state.voice_cuts.length > 0 && (
              <Button size="sm" variant="ghost" onClick={clearCuts}>
                Clear cuts
              </Button>
            )}
          </div>

          {/* Volume + fades */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Volume {Math.round(state.voice_volume * 100)}%</Label>
              <Slider
                min={0}
                max={2}
                step={0.05}
                value={[state.voice_volume]}
                onValueChange={(v) => onChange({ voice_volume: v[0] })}
                onValueCommit={(v) => void persist({ voice_volume: v[0] })}
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Fade in (ms)</Label>
              <Input
                type="number"
                min={0}
                step={50}
                value={state.voice_fade_in_ms}
                onChange={(e) => onChange({ voice_fade_in_ms: parseInt(e.target.value) || 0 })}
                onBlur={(e) => void persist({ voice_fade_in_ms: parseInt(e.target.value) || 0 })}
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Fade out (ms)</Label>
              <Input
                type="number"
                min={0}
                step={50}
                value={state.voice_fade_out_ms}
                onChange={(e) => onChange({ voice_fade_out_ms: parseInt(e.target.value) || 0 })}
                onBlur={(e) => void persist({ voice_fade_out_ms: parseInt(e.target.value) || 0 })}
                className="h-8"
              />
            </div>
          </div>

          {/* Replace / Delete */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={!!busy || recording}>
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Replace (upload)
            </Button>
            {recording ? (
              <Button size="sm" variant="destructive" onClick={stopRecording}>
                <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
                Stop {formatMs(recMs)}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={startRecording} disabled={!!busy}>
                <Mic className="mr-1.5 h-3.5 w-3.5" /> Re-record
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-destructive" onClick={deleteAudio} disabled={!!busy}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete audio
            </Button>
            {busy && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {busy}
              </span>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}

function formatMs(ms: number) {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const r = (s - m * 60).toFixed(1);
  return m > 0 ? `${m}:${r.padStart(4, "0")}` : `${r}s`;
}
