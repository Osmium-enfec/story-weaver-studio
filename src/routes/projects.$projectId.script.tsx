import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProject } from "@/components/project-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { splitScript, detectConcepts, type SplitMode } from "@/lib/scene-splitter";
import { toast } from "sonner";
import { Sparkles, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/projects/$projectId/script")({
  component: ScriptStudio,
});

const SPLIT_MODES: { value: SplitMode; label: string }[] = [
  { value: "sentence", label: "Sentence based" },
  { value: "paragraph", label: "Paragraph based" },
  { value: "concept", label: "Concept based" },
  { value: "manual", label: "Manual markers (---)" },
];

function ScriptStudio() {
  const { project, reload } = useProject();
  const { projectId } = useParams({ from: "/projects/$projectId/script" });
  const navigate = useNavigate();
  const [script, setScript] = useState(project.script);
  const [mode, setMode] = useState<SplitMode>("paragraph");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setScript(project.script);
  }, [project.script]);

  const preview = useMemo(() => splitScript(script, mode, project.course_type), [script, mode, project.course_type]);
  const concepts = useMemo(() => detectConcepts(script), [script]);
  const totalMs = preview.reduce((s, p) => s + p.duration_ms, 0);
  const longScenes = preview.filter((s) => s.narration.length > 280).length;

  async function saveScript() {
    const { error } = await supabase.from("projects").update({ script }).eq("id", projectId);
    if (error) return toast.error(error.message);
    toast.success("Script saved");
    reload();
  }

  async function generateStoryboard() {
    if (preview.length === 0) {
      toast.error("Add some script text first");
      return;
    }
    setBusy(true);
    // Save script
    await supabase.from("projects").update({ script, estimated_duration_ms: totalMs }).eq("id", projectId);
    // Replace existing scenes
    await supabase.from("scenes").delete().eq("project_id", projectId);
    const rows = preview.map((s, i) => ({
      project_id: projectId,
      order_index: i,
      narration: s.narration,
      visual_brief: s.visual_brief,
      detected_concepts: s.detected_concepts,
      duration_ms: s.duration_ms,
      suggested_animation: s.suggested_animation,
    }));
    const { error } = await supabase.from("scenes").insert(rows);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Generated ${rows.length} screens`);
    navigate({ to: `/projects/${projectId}/storyboard` as string });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="script" className="text-base font-semibold">Your script</Label>
          <Button variant="ghost" size="sm" onClick={saveScript}>Save draft</Button>
        </div>
        <Textarea
          id="script"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="Paste or type your lesson script here. Use blank lines to separate paragraphs, or '---' for manual scene markers."
          className="min-h-[460px] font-mono text-sm leading-relaxed"
        />
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-sm">Split mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as SplitMode)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPLIT_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={generateStoryboard} disabled={busy} size="lg" className="ml-auto gap-2">
            <Sparkles className="h-4 w-4" />
            {busy ? "Generating…" : "Generate Storyboard"}
          </Button>
        </div>
      </div>

      <aside className="space-y-4 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Script analysis
        </h2>
        <Stat label="Estimated screens" value={preview.length.toString()} />
        <Stat label="Estimated duration" value={`${(totalMs / 1000).toFixed(1)}s`} />
        <Stat label="Words" value={script.trim().split(/\s+/).filter(Boolean).length.toString()} />
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Detected concepts
          </div>
          {concepts.length === 0 ? (
            <p className="text-sm text-muted-foreground">None detected yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {concepts.map((c) => (
                <span key={c} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs">
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
        {longScenes > 0 && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{longScenes} scene{longScenes > 1 ? "s are" : " is"} longer than 280 chars. Consider splitting.</span>
          </div>
        )}
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  );
}
