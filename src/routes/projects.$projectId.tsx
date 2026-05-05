import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Project } from "@/lib/db-types";
import { ProjectContext } from "@/components/project-context";
import { useToolbar } from "@/components/toolbar-store";
import { Button } from "@/components/ui/button";
import { Play, Square, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectLayout,
});

const ICONS = { play: Play, stop: Square, download: Download };

function ProjectLayout() {
  const { projectId } = useParams({ from: "/projects/$projectId" });
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const { actions } = useToolbar();

  async function reload() {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .maybeSingle();
    if (error) toast.error(error.message);
    setProject(data as Project | null);
    setLoading(false);
  }

  useEffect(() => {
    setLoading(true);
    reload();
  }, [projectId]);

  if (loading) return <div className="text-muted-foreground">Loading project…</div>;
  if (!project) return <div className="text-muted-foreground">Project not found.</div>;

  return (
    <ProjectContext.Provider value={{ project, reload }}>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{project.title}</h1>
            <p className="text-sm text-muted-foreground">
              {project.course_type} · {project.audience_level} · {project.aspect_ratio} · {project.theme}
            </p>
          </div>
          {actions.length > 0 && (
            <div className="flex items-center gap-2">
              {actions.map((a, i) => {
                const Icon = a.icon ? ICONS[a.icon] : null;
                return (
                  <Button
                    key={i}
                    size="sm"
                    variant={a.variant ?? "default"}
                    disabled={a.disabled}
                    onClick={a.onClick}
                    className="gap-1"
                  >
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    {a.label}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
        <Outlet />
      </div>
    </ProjectContext.Provider>
  );
}

