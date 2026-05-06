import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Mic, Upload, Loader2, Wand2 } from "lucide-react";
import { transcribeAndSplit } from "@/server/voice.functions";

export const Route = createFileRoute("/projects/$projectId/voice")({
  component: VoicePage,
});

const MAX_BYTES = 25 * 1024 * 1024; // 25MB
const ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/x-m4a,audio/webm";

function VoicePage() {
  const { projectId } = useParams({ from: "/projects/$projectId/voice" });
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sceneCount, setSceneCount] = useState<string>("auto");
  const [uploaded, setUploaded] = useState<{ url: string; path: string } | null>(null);
  const [progress, setProgress] = useState<string>("");

  function pickFile(f: File | null) {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast.error("File too large. Max 25MB.");
      return;
    }
    setFile(f);
    setUploaded(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  }

  async function uploadFile() {
    if (!file) return;
    setUploading(true);
    setProgress("Uploading audio…");
    try {
      const ext = file.name.split(".").pop() || "mp3";
      const path = `${projectId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("voice-uploads")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("voice-uploads").getPublicUrl(path);
      setUploaded({ url: pub.publicUrl, path });
      toast.success("Audio uploaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      setProgress("");
    }
  }

  async function runTranscribe() {
    if (!uploaded) {
      toast.error("Upload the audio first");
      return;
    }
    if (
      !confirm(
        "This will replace any existing canvases for this project with new ones generated from the transcript. Continue?",
      )
    ) {
      return;
    }
    setTranscribing(true);
    setProgress("Transcribing with Whisper… this can take 10-60s");
    try {
      const target = sceneCount === "auto" ? undefined : parseInt(sceneCount, 10);
      const res = await transcribeAndSplit({
        data: {
          projectId,
          voiceUrl: uploaded.url,
          storagePath: uploaded.path,
          targetSceneCount: target,
        },
      });
      toast.success(`Created ${res.sceneCount} canvases from voice`);
      navigate({ to: "/projects/$projectId/script", params: { projectId } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTranscribing(false);
      setProgress("");
    }
  }

  const busy = uploading || transcribing;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-2">
      <header className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Mic className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Voice Upload</h1>
          <p className="text-sm text-muted-foreground">
            Upload a voiceover. We'll transcribe it with Whisper, split it into canvases, and map words to animations.
          </p>
        </div>
      </header>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <Label className="mb-2 block text-sm font-medium">1. Choose audio file</Label>
        <div
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 p-8 text-center transition hover:border-primary hover:bg-muted/30"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            pickFile(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">
            {file ? file.name : "Click or drag an audio file here"}
          </p>
          <p className="text-xs text-muted-foreground">MP3, WAV, M4A · max 25MB</p>
          <Input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {previewUrl && (
          <div className="mt-4">
            <audio controls src={previewUrl} className="w-full" />
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button onClick={uploadFile} disabled={!file || busy || !!uploaded}>
            {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {uploaded ? "Uploaded ✓" : "Upload"}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <Label className="mb-2 block text-sm font-medium">2. Number of canvases</Label>
        <div className="flex flex-wrap gap-2">
          {["auto", "3", "5", "8", "10", "15"].map((n) => (
            <Button
              key={n}
              size="sm"
              variant={sceneCount === n ? "default" : "outline"}
              onClick={() => setSceneCount(n)}
              disabled={busy}
            >
              {n === "auto" ? "Auto" : n}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Auto picks ~6-10s per canvas based on sentence boundaries.
        </p>

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground min-h-5">{progress}</div>
          <Button onClick={runTranscribe} disabled={!uploaded || busy}>
            {transcribing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="mr-2 h-4 w-4" />
            )}
            Transcribe & build canvases
          </Button>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        After this finishes you'll be taken to the Script editor. Each canvas will have its narration
        and word timings set, so animations you bind to words will reveal in sync with the voice.
      </p>
    </div>
  );
}
