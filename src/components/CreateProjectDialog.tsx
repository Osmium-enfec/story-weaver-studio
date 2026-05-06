import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { WORKSPACE_ID, type AspectRatio, type AudienceLevel, type CourseType, type ThemeName, type VoiceMode } from "@/lib/db-types";
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
import { Upload, Mic2, Loader2, X } from "lucide-react";
import { transcribeAndSplit } from "@/server/voice.functions";

const COURSES: CourseType[] = ["Python", "Java", "Android", "Web", "DSA", "Database", "API", "Other"];
const LEVELS: AudienceLevel[] = ["Beginner", "Intermediate", "Advanced"];
const RATIOS: AspectRatio[] = ["16:9", "9:16", "1:1"];
const THEMES: ThemeName[] = ["Whiteboard", "Dark Code", "Flat Modern", "Android UI", "Classroom"];
const ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/x-m4a,audio/webm";

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
  const [course, setCourse] = useState<CourseType>("Python");
  const [level, setLevel] = useState<AudienceLevel>("Beginner");
  const [ratio, setRatio] = useState<AspectRatio>("16:9");
  const [theme, setTheme] = useState<ThemeName>("Whiteboard");
  const [voice, setVoice] = useState<VoiceMode>("no_voice");
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  function pickFile(f: File | null) {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) return toast.error("Max 25MB");
    setVoiceFile(f);
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
        course_type: course,
        audience_level: level,
        aspect_ratio: ratio,
        theme,
        voice_mode: voice,
      })
      .select()
      .single();
    if (error || !data) {
      setBusy(false);
      setProgress("");
      return toast.error(error?.message ?? "Failed to create project");
    }

    // If they picked a voice file, upload + transcribe before navigating
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
        toast.success("Voice transcribed and split into canvases");
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
          <DialogDescription>Set up the basics. You can change everything later.</DialogDescription>
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
            <Field label="Course type">
              <SimpleSelect value={course} onChange={(v) => setCourse(v as CourseType)} options={COURSES} />
            </Field>
            <Field label="Audience level">
              <SimpleSelect value={level} onChange={(v) => setLevel(v as AudienceLevel)} options={LEVELS} />
            </Field>
            <Field label="Aspect ratio">
              <SimpleSelect value={ratio} onChange={(v) => setRatio(v as AspectRatio)} options={RATIOS} />
            </Field>
            <Field label="Theme">
              <SimpleSelect value={theme} onChange={(v) => setTheme(v as ThemeName)} options={THEMES} />
            </Field>
          </div>
          <Field label="Voice">
            <SimpleSelect
              value={voice}
              onChange={(v) => {
                setVoice(v as VoiceMode);
                if (v !== "upload_voice") setVoiceFile(null);
              }}
              options={[
                { value: "upload_voice", label: "Upload voice now" },
                { value: "ai_voice", label: "Generate AI voice later" },
                { value: "no_voice", label: "No voice for now" },
              ]}
            />
          </Field>

          {voice === "upload_voice" && (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3">
              {voiceFile ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
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

function SimpleSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[] | { value: string; label: string }[];
}) {
  const opts = (options as Array<string | { value: string; label: string }>).map((o) =>
    typeof o === "string" ? { value: o, label: o } : o,
  );
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {opts.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
