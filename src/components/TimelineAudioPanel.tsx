import { useEffect, useRef, useState } from "react";
import { Mic, Upload, Loader2, Trash2, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { transcribeClip } from "@/server/voice.functions";
import type { CanvasAudioState } from "@/components/CanvasAudioEditor";

const ACCEPT =
  "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/x-m4a,audio/webm";

export interface TimelineAudioPanelProps {
  sceneId: string;
  projectId: string;
  state: CanvasAudioState;
  narration: string;
  wordTimings: { text: string; start_ms: number; end_ms: number }[];
  onChange: (
    patch: Partial<CanvasAudioState> & {
      narration?: string;
      word_timings?: { text: string; start_ms: number; end_ms: number }[];
    },
  ) => void;
  onWordSearch?: (word: string) => void;
}

function fmt(ms: number) {
  const s = Math.max(0, ms) / 1000;
  return s < 60
    ? `${s.toFixed(1)}s`
    : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function TimelineAudioPanel({
  sceneId,
  projectId,
  state,
  narration,
  wordTimings,
  onChange,
  onWordSearch,
}: TimelineAudioPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [busy, setBusy] = useState("");
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function uploadFile(file: File) {
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Max 25MB");
      return;
    }
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
      });
      const { data: row } = await supabase
        .from("scenes")
        .select("narration, word_timings")
        .eq("id", sceneId)
        .single();
      if (row) {
        onChange({
          narration: (row as { narration: string }).narration,
          word_timings:
            ((row as { word_timings: unknown }).word_timings as {
              text: string;
              start_ms: number;
              end_ms: number;
            }[]) ?? [],
        });
      }
      toast.success("Audio transcribed");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        const file = new File([blob], `rec-${Date.now()}.webm`, { type: mime });
        await uploadFile(file);
      };
      mediaRef.current = rec;
      rec.start();
      setRecording(true);
      setRecMs(0);
      const startedAt = Date.now();
      timerRef.current = setInterval(() => setRecMs(Date.now() - startedAt), 100);
    } catch {
      toast.error("Microphone access denied");
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function deleteAudio() {
    if (!confirm("Remove audio from this canvas?")) return;
    const patch = {
      voice_url: null,
      voice_start_ms: null,
      voice_end_ms: null,
      voice_trim_start_ms: 0,
      voice_trim_end_ms: null,
      voice_cuts: [],
    };
    onChange({ ...patch, word_timings: [], narration: "" });
    await supabase
      .from("scenes")
      .update({
        ...patch,
        word_timings: [] as unknown as never,
        narration: "",
      } as never)
      .eq("id", sceneId);
  }

  const hasAudio = !!state.voice_url;
  const words = narration
    ? narration.split(/(\s+)/).filter((w) => w.length > 0)
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {!recording ? (
          <Button
            size="sm"
            variant="outline"
            onClick={startRecording}
            disabled={!!busy}
            className="h-7 border-white/10 bg-white/5 text-[11px] text-zinc-200 hover:bg-white/10"
          >
            <Mic className="mr-1 h-3 w-3" /> Record
          </Button>
        ) : (
          <Button
            size="sm"
            variant="destructive"
            onClick={stopRecording}
            className="h-7 text-[11px]"
          >
            <Square className="mr-1 h-3 w-3" /> Stop {fmt(recMs)}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={!!busy || recording}
          className="h-7 border-white/10 bg-white/5 text-[11px] text-zinc-200 hover:bg-white/10"
        >
          <Upload className="mr-1 h-3 w-3" /> Upload
        </Button>
        {hasAudio && !busy && !recording && (
          <Button
            size="sm"
            variant="ghost"
            onClick={deleteAudio}
            className="h-7 px-2 text-[11px] text-red-300 hover:bg-red-500/10 hover:text-red-200"
            title="Delete audio"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
        {busy && (
          <span className="flex items-center gap-1 text-[11px] text-zinc-400">
            <Loader2 className="h-3 w-3 animate-spin" /> {busy}
          </span>
        )}
      </div>

      {hasAudio && state.voice_url && (
        <audio
          src={state.voice_url}
          controls
          className="w-full"
          style={{ height: 28 }}
        />
      )}

      {/* Transcript */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-white/10 bg-white/[0.03] p-2">
        {narration ? (
          <div className="text-[11px] leading-6 text-zinc-200">
            {words.map((w, i) => {
              const trimmed = w.trim();
              if (!trimmed) return <span key={i}>{w}</span>;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onWordSearch?.(trimmed)}
                  className="rounded px-0.5 transition hover:bg-sky-500/30 hover:text-white"
                  title={`Search animations for "${trimmed}"`}
                >
                  {w}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed text-zinc-500">
            {hasAudio
              ? "No transcript yet."
              : "Record or upload audio to generate a transcript. Click any word to search animations for it (placed on the timeline)."}
          </p>
        )}
        {wordTimings.length > 0 && (
          <p className="mt-2 text-[10px] text-zinc-600">
            {wordTimings.length} timed word{wordTimings.length === 1 ? "" : "s"}
          </p>
        )}
      </div>

      <input
        ref={fileRef}
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
