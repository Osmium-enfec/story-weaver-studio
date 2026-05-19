import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Project, CourseType } from "@/lib/db-types";
import { WORKSPACE_ID } from "@/lib/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Film, MoreVertical, Copy, Trash2, Pencil } from "lucide-react";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectThumbnail } from "@/components/ProjectThumbnail";
import { toast } from "sonner";

export const Route = createFileRoute("/")({ component: Dashboard });

const COURSE_FILTERS: (CourseType | "All")[] = [
  "All", "Python", "Java", "Android", "Web", "DSA", "Database", "API", "Other",
];

function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CourseType | "All">("All");
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("workspace_id", WORKSPACE_ID)
      .order("updated_at", { ascending: false });
    if (error) toast.error(error.message);
    setProjects((data ?? []) as Project[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = projects.filter((p) => {
    if (filter !== "All" && p.course_type !== filter) return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function handleDuplicate(p: Project) {
    const { data, error } = await supabase
      .from("projects")
      .insert({
        workspace_id: WORKSPACE_ID,
        title: `${p.title} (copy)`,
        course_type: p.course_type,
        audience_level: p.audience_level,
        aspect_ratio: p.aspect_ratio,
        theme: p.theme,
        voice_mode: p.voice_mode,
        script: p.script,
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    toast.success("Project duplicated");
    if (data) navigate({ to: `/projects/${data.id}/script` as string });
  }

  async function handleRename(p: Project) {
    const next = window.prompt("New title", p.title);
    if (!next || next === p.title) return;
    const { error } = await supabase.from("projects").update({ title: next }).eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Renamed");
    load();
  }

  async function handleDelete(p: Project) {
    if (!window.confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("projects").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Project deleted");
    load();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your videos</h1>
          <p className="mt-1 text-muted-foreground">
            Turn programming course scripts into animated explainer videos.
          </p>
        </div>
        <Button size="lg" onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Create New Video
        </Button>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search projects"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {COURSE_FILTERS.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                filter === c
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <Film className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No projects yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first video to get started.
          </p>
          <Button onClick={() => setCreateOpen(true)} className="mt-4 gap-2">
            <Plus className="h-4 w-4" /> Create New Video
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="group relative overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md"
            >
              <Link
                to={`/projects/${p.id}/script` as string}
                className="block aspect-video bg-gradient-to-br from-primary/20 to-accent"
              >
                <div className="flex h-full items-center justify-center text-primary">
                  <Film className="h-10 w-10 opacity-40" />
                </div>
              </Link>
              <div className="flex items-start justify-between gap-2 p-4">
                <div className="min-w-0">
                  <Link to={`/projects/${p.id}/script` as string}>
                    <h3 className="truncate font-semibold hover:underline">{p.title}</h3>
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.course_type} · {p.audience_level} · {p.aspect_ratio}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => handleRename(p)}>
                      <Pencil className="mr-2 h-4 w-4" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleDuplicate(p)}>
                      <Copy className="mr-2 h-4 w-4" /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleDelete(p)} className="text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
    </div>
  );
}
