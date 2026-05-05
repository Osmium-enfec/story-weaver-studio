import { useState } from "react";
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

const COURSES: CourseType[] = ["Python", "Java", "Android", "Web", "DSA", "Database", "API", "Other"];
const LEVELS: AudienceLevel[] = ["Beginner", "Intermediate", "Advanced"];
const RATIOS: AspectRatio[] = ["16:9", "9:16", "1:1"];
const THEMES: ThemeName[] = ["Whiteboard", "Dark Code", "Flat Modern", "Android UI", "Classroom"];

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
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit() {
    if (!title.trim()) {
      toast.error("Please enter a video title");
      return;
    }
    setBusy(true);
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
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Project created");
    onOpenChange(false);
    setTitle("");
    onCreated?.();
    if (data) navigate({ to: `/projects/${data.id}/script` as string });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              onChange={(v) => setVoice(v as VoiceMode)}
              options={[
                { value: "upload_voice", label: "Upload voice later" },
                { value: "ai_voice", label: "Generate AI voice later" },
                { value: "no_voice", label: "No voice for now" },
              ]}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
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
