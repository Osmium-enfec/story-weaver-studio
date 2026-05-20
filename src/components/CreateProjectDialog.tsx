import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { WORKSPACE_ID, type AspectRatio, type CanvasMode, type VoiceMode } from "@/lib/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, Mic2, Loader2, X, Flame, Palette } from "lucide-react";
import { transcribeAndSplit, seedAnimationsForProject } from "@/server/voice.functions";
import { setPendingTheme, type PendingTheme } from "@/lib/pending-theme";

const RATIOS: AspectRatio[] = ["16:9", "9:16", "1:1"];
const ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/x-m4a,audio/webm";

interface SavedThemeOption { id: string; name: string }

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [ratio, setRatio] = useState<AspectRatio>("16:9");
  // themeKey: "none" | "firebase" | "saved:<id>"
  const [themeKey, setThemeKey] = useState<string>("firebase");
  const [savedThemes, setSavedThemes] = useState<SavedThemeOption[]>([]);
  const [voice, setVoice] = useState<VoiceMode>("no_voice");
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("word");
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const { data } = await supabase
        .from("user_themes")
        .select("id, name")
        .order("created_at", { ascending: true });
      setSavedThemes((data ?? []).map((r) => ({ id: r.id, name: r.name })));
    })();
  }, [open]);

  function pickFile(f: File | null) {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) return toast.error("Max 25MB");
    setVoiceFile(f);
  }

  function themeFromKey(): PendingTheme {
    if (themeKey === "firebase") return { kind: "firebase" };
    if (themeKey.startsWith("saved:")) return { kind: "saved", themeId: themeKey.slice(6) };
    return { kind: "none" };
  }

  async function submit() {
    if (!title.trim()) {
      toast.error("Please enter a video title");
      return;
    }
    setBusy(true);
    setProgress("Creating project…");
    const { data, error } = await supabase
      .from("projects")
      .insert({
        workspace_id: WORKSPACE_ID,
        title: title.trim(),
        aspect_ratio: ratio,
        voice_mode: voice,
        // legacy required-ish columns kept at sensible defaults
        course_type: "Other",
        audience_level: "Beginner",
        theme: "Whiteboard",
      })
      .select()
      .single();
    if (error || !data) {
      setBusy(false);
      setProgress("");
      return toast.error(error?.message ?? "Failed to create project");
    }

    // Hand the chosen theme off to the script route on next mount.
    setPendingTheme(data.id, themeFromKey());

    if (voice === "upload_voice" && voiceFile) {
      try {
        setProgress("Uploading voice…");
        const ext = voiceFile.name.split(".").pop() || "mp3";
        const path = `${data.id}/${Date.now()}.${ext}`;
        const up = await supabase.storage
          .from("voice-uploads")
          .upload(path, voiceFile, { contentType: voiceFile.type, upsert: false });
        if (up.error) throw up.error;
        const { data: pub } = supabase.storage.from("voice-uploads").getPublicUrl(path);

        setProgress("Transcribing & splitting into canvases…");
        await transcribeAndSplit({
          data: { projectId: data.id, voiceUrl: pub.publicUrl, storagePath: path },
        });
        setProgress("Adding animations to each canvas…");
        try {
          await seedAnimationsForProject({ data: { projectId: data.id } });
        } catch (e) {
          console.error("seed failed", e);
        }
        toast.success("Voice transcribed and animations added");
      } catch (e) {
        toast.error(`Voice setup failed: ${(e as Error).message}`);
      }
    }

    setBusy(false);
    setProgress("");
    toast.success("Project created");
    onOpenChange(false);
    setTitle("");
    setVoiceFile(null);
    onCreated?.();
    navigate({ to: `/projects/${data.id}/script` as string });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Video</DialogTitle>
          <DialogDescription>Pick a title, format, voice, and theme — change anything later.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Video title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Python loops in 60 seconds"
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Aspect ratio">
              <Select value={ratio} onValueChange={(v) => setRatio(v as AspectRatio)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RATIOS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Voice">
              <Select
                value={voice}
                onValueChange={(v) => {
                  setVoice(v as VoiceMode);
                  if (v !== "upload_voice") setVoiceFile(null);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="upload_voice">Upload voice now</SelectItem>
                  <SelectItem value="ai_voice">Generate AI voice later</SelectItem>
                  <SelectItem value="no_voice">No voice for now</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Theme">
            <Select value={themeKey} onValueChange={setThemeKey}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border border-border bg-muted" /> No theme</span>
                </SelectItem>
                <SelectItem value="firebase">
                  <span className="flex items-center gap-2">
                    <span className="grid h-4 w-4 place-items-center rounded-sm bg-gradient-to-br from-[#ffb404] via-[#f67e00] to-[#e13900] text-white">
                      <Flame className="h-2.5 w-2.5" />
                    </span>
                    Firebase (built-in)
                  </span>
                </SelectItem>
                {savedThemes.length > 0 && (
                  <>
                    <div className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">My themes</div>
                    {savedThemes.map((t) => (
                      <SelectItem key={t.id} value={`saved:${t.id}`}>
                        <span className="flex items-center gap-2"><Palette className="h-3.5 w-3.5 text-muted-foreground" /> {t.name}</span>
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The theme's background, fonts, and colors will be applied to every new scene.
            </p>
          </Field>

          {voice === "upload_voice" && (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3">
              {voiceFile ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Mic2 className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate text-sm">{voiceFile.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({(voiceFile.size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setVoiceFile(null)} disabled={busy}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  className="flex w-full flex-col items-center gap-1 py-3 text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-5 w-5" />
                  <span>Click to upload voiceover</span>
                  <span className="text-xs">MP3, WAV, M4A · max 25MB · auto-transcribed with Whisper</span>
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
            </div>
          )}

          {progress && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {progress}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Working…" : voice === "upload_voice" && voiceFile ? "Create & transcribe" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  );
}
