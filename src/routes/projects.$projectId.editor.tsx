import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Scene } from "@/lib/db-types";
import { useProject } from "@/components/project-context";
import { toast } from "sonner";

export const Route = createFileRoute("/projects/$projectId/editor")({
  component: Editor,
});

function Editor() {
  const { projectId } = useParams({ from: "/projects/$projectId/editor" });
  const { project } = useProject();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("scenes")
        .select("*")
        .eq("project_id", projectId)
        .order("order_index");
      if (error) toast.error(error.message);
      const list = (data ?? []) as Scene[];
      setScenes(list);
      setSelectedId(list[0]?.id ?? null);
    })();
  }, [projectId]);

  const selected = scenes.find((s) => s.id === selectedId) ?? null;
  const ratio = project.aspect_ratio;
  const aspect = ratio === "9:16" ? "9/16" : ratio === "1:1" ? "1/1" : "16/9";

  return (
    <div className="grid h-[calc(100vh-13rem)] grid-cols-[220px_1fr_300px] grid-rows-[1fr_140px] gap-3">
      {/* Screen list */}
      <aside className="row-span-2 overflow-y-auto rounded-xl border border-border bg-card p-3">
        <h3 className="mb-2 px-1 text-xs font-semibold uppercase text-muted-foreground">Screens</h3>
        <div className="space-y-1.5">
          {scenes.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`flex w-full items-center gap-2 rounded-md p-2 text-left text-sm transition-colors ${
                selectedId === s.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-secondary"
              }`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-semibold ${
                selectedId === s.id ? "bg-primary-foreground/20" : "bg-secondary"
              }`}>{i + 1}</span>
              <span className="line-clamp-1">{s.narration || "(empty)"}</span>
            </button>
          ))}
          {scenes.length === 0 && (
            <p className="px-1 text-xs text-muted-foreground">No screens yet.</p>
          )}
        </div>
      </aside>

      {/* Canvas */}
      <div className="flex items-center justify-center rounded-xl border border-border bg-muted/30 p-6">
        {selected ? (
          <div
            className="relative max-h-full w-full overflow-hidden rounded-lg shadow-lg"
            style={{
              aspectRatio: aspect,
              maxWidth: ratio === "9:16" ? "320px" : "720px",
              background: selected.background?.value ?? "#fff",
            }}
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              {selected.suggested_animation && (
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {selected.suggested_animation}
                </span>
              )}
              <p className="text-base font-medium text-foreground">{selected.narration}</p>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">Select a screen to preview</p>
        )}
      </div>

      {/* Inspector */}
      <aside className="row-span-2 overflow-y-auto rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Inspector</h3>
        {selected ? (
          <div className="space-y-3 text-sm">
            <Field label="Duration">{(selected.duration_ms / 1000).toFixed(1)}s</Field>
            <Field label="Transition">{selected.transition}</Field>
            <Field label="Animation">{selected.suggested_animation ?? "—"}</Field>
            <div>
              <div className="text-xs text-muted-foreground">Concepts</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {selected.detected_concepts.length === 0 ? (
                  <span className="text-xs text-muted-foreground">None</span>
                ) : (
                  selected.detected_concepts.map((c) => (
                    <span key={c} className="rounded-full bg-secondary px-2 py-0.5 text-xs">{c}</span>
                  ))
                )}
              </div>
            </div>
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              Detailed element editing coming next pass.
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No screen selected</p>
        )}
      </aside>

      {/* Timeline */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Timeline</h3>
          <span className="text-xs text-muted-foreground">
            {(scenes.reduce((s, x) => s + x.duration_ms, 0) / 1000).toFixed(1)}s total
          </span>
        </div>
        <div className="mt-2 flex h-16 items-stretch gap-1 overflow-x-auto rounded bg-muted/40 p-1">
          {scenes.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`flex shrink-0 flex-col justify-between rounded px-2 py-1 text-left text-xs transition-colors ${
                selectedId === s.id ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"
              }`}
              style={{ width: Math.max(50, s.duration_ms / 60) }}
            >
              <span className="font-semibold">{i + 1}</span>
              <span>{(s.duration_ms / 1000).toFixed(1)}s</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}
