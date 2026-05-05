import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Scene } from "@/lib/db-types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Plus, Trash2, Copy, ArrowUp, ArrowDown, ArrowRight, Save,
} from "lucide-react";
import { splitScript } from "@/lib/scene-splitter";
import { useProject } from "@/components/project-context";

export const Route = createFileRoute("/projects/$projectId/storyboard")({
  component: Storyboard,
});

function Storyboard() {
  const { projectId } = useParams({ from: "/projects/$projectId/storyboard" });
  const { project } = useProject();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("scenes")
      .select("*")
      .eq("project_id", projectId)
      .order("order_index");
    if (error) toast.error(error.message);
    const list = (data ?? []) as Scene[];
    setScenes(list);
    setSelectedId((curr) => curr && list.some((s) => s.id === curr) ? curr : list[0]?.id ?? null);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [projectId]);

  const selected = scenes.find((s) => s.id === selectedId) ?? null;

  async function reorder(newScenes: Scene[]) {
    setScenes(newScenes);
    await Promise.all(
      newScenes.map((s, i) =>
        supabase.from("scenes").update({ order_index: i }).eq("id", s.id),
      ),
    );
  }

  async function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= scenes.length) return;
    const next = [...scenes];
    [next[idx], next[target]] = [next[target], next[idx]];
    await reorder(next);
  }

  async function addScene() {
    const order = scenes.length;
    const { data, error } = await supabase
      .from("scenes")
      .insert({ project_id: projectId, order_index: order, narration: "New screen", visual_brief: "" })
      .select()
      .single();
    if (error) return toast.error(error.message);
    if (data) {
      setSelectedId(data.id);
      toast.success("Screen added");
      load();
    }
  }

  async function duplicate(scene: Scene) {
    const { data, error } = await supabase
      .from("scenes")
      .insert({
        project_id: projectId,
        order_index: scene.order_index + 1,
        narration: scene.narration,
        visual_brief: scene.visual_brief,
        suggested_animation: scene.suggested_animation,
        detected_concepts: scene.detected_concepts,
        duration_ms: scene.duration_ms,
        transition: scene.transition,
        background: scene.background,
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    // Re-index everyone after
    const after = scenes.filter((s) => s.order_index > scene.order_index);
    await Promise.all(
      after.map((s) =>
        supabase.from("scenes").update({ order_index: s.order_index + 1 }).eq("id", s.id),
      ),
    );
    if (data) setSelectedId(data.id);
    toast.success("Screen duplicated");
    load();
  }

  async function remove(scene: Scene) {
    if (!window.confirm("Delete this screen?")) return;
    const { error } = await supabase.from("scenes").delete().eq("id", scene.id);
    if (error) return toast.error(error.message);
    toast.success("Screen deleted");
    load();
  }

  async function regenerateAll() {
    if (!window.confirm("Regenerate ALL screens from the current script? This will replace existing screens.")) return;
    const preview = splitScript(project.script, "paragraph", project.course_type);
    await supabase.from("scenes").delete().eq("project_id", projectId);
    if (preview.length) {
      const rows = preview.map((s, i) => ({
        project_id: projectId,
        order_index: i,
        narration: s.narration,
        visual_brief: s.visual_brief,
        detected_concepts: s.detected_concepts,
        duration_ms: s.duration_ms,
        suggested_animation: s.suggested_animation,
      }));
      await supabase.from("scenes").insert(rows);
    }
    toast.success("Regenerated");
    load();
  }

  async function saveSelected(patch: Partial<Scene>) {
    if (!selected) return;
    setScenes((prev) => prev.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)));
  }

  async function flushSelected() {
    if (!selected) return;
    const { error } = await supabase
      .from("scenes")
      .update({
        narration: selected.narration,
        visual_brief: selected.visual_brief,
        duration_ms: selected.duration_ms,
        suggested_animation: selected.suggested_animation,
      })
      .eq("id", selected.id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    load();
  }

  if (loading) return <div className="text-muted-foreground">Loading storyboard…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={addScene} variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Add screen
        </Button>
        <Button onClick={regenerateAll} variant="ghost" size="sm">
          Regenerate all
        </Button>
        <div className="ml-auto">
          <Button asChild className="gap-2">
            <Link to={`/projects/${projectId}/editor` as string}>
              Continue to Editor <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {scenes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          No screens yet. Add one or go back to the Script step.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr_340px]">
          {/* Left: list */}
          <aside className="space-y-2">
            {scenes.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`group w-full rounded-lg border p-3 text-left transition-colors ${
                  selectedId === s.id
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:bg-secondary/50"
                }`}
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Screen {i + 1}</span>
                  <span>{(s.duration_ms / 1000).toFixed(1)}s</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm">{s.narration || "(empty)"}</p>
              </button>
            ))}
          </aside>

          {/* Center: cards */}
          <div className="space-y-3">
            {scenes.map((s, i) => (
              <div
                key={s.id}
                className={`rounded-xl border bg-card p-4 transition-colors ${
                  selectedId === s.id ? "border-primary" : "border-border"
                }`}
                onClick={() => setSelectedId(s.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Screen {i + 1} · {(s.duration_ms / 1000).toFixed(1)}s
                  </div>
                  <div className="flex items-center gap-1">
                    <IconBtn onClick={() => move(i, -1)} title="Move up" disabled={i === 0}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn onClick={() => move(i, 1)} title="Move down" disabled={i === scenes.length - 1}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn onClick={() => duplicate(s)} title="Duplicate">
                      <Copy className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn onClick={() => remove(s)} title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconBtn>
                  </div>
                </div>
                <p className="mt-2 text-sm">{s.narration}</p>
                {s.detected_concepts.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.detected_concepts.map((c) => (
                      <span key={c} className="rounded-full bg-secondary px-2 py-0.5 text-xs">{c}</span>
                    ))}
                  </div>
                )}
                {s.visual_brief && (
                  <p className="mt-2 text-xs italic text-muted-foreground">🎬 {s.visual_brief}</p>
                )}
              </div>
            ))}
          </div>

          {/* Right: details */}
          <aside className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">Screen details</h3>
            {selected ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Narration</Label>
                  <Textarea
                    value={selected.narration}
                    onChange={(e) => saveSelected({ narration: e.target.value })}
                    rows={5}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Visual brief</Label>
                  <Textarea
                    value={selected.visual_brief}
                    onChange={(e) => saveSelected({ visual_brief: e.target.value })}
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Duration (s)</Label>
                    <Input
                      type="number"
                      step="0.5"
                      value={(selected.duration_ms / 1000).toFixed(1)}
                      onChange={(e) =>
                        saveSelected({ duration_ms: Math.max(500, Math.round(parseFloat(e.target.value || "0") * 1000)) })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Animation</Label>
                    <Input
                      value={selected.suggested_animation ?? ""}
                      onChange={(e) => saveSelected({ suggested_animation: e.target.value || null })}
                      placeholder="e.g. for-loop"
                    />
                  </div>
                </div>
                <Button onClick={flushSelected} className="w-full gap-2">
                  <Save className="h-4 w-4" /> Save changes
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select a screen to edit.</p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      disabled={disabled}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}
