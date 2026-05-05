import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Project } from "@/lib/db-types";
import { ProjectContext } from "@/components/project-context";
import { toast } from "sonner";

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectLayout,
});

function ProjectLayout() {
  const { projectId } = useParams({ from: "/projects/$projectId" });
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

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
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.title}</h1>
          <p className="text-sm text-muted-foreground">
            {project.course_type} · {project.audience_level} · {project.aspect_ratio} · {project.theme}
          </p>
        </div>
        <Outlet />
      </div>
    </ProjectContext.Provider>
  );
}
