import { Link, useLocation } from "@tanstack/react-router";
import { Check } from "lucide-react";

const STEPS = [
  { key: "script", label: "Script", path: "script" },
  { key: "storyboard", label: "Storyboard", path: "storyboard" },
  { key: "editor", label: "Editor", path: "editor" },
  { key: "voice", label: "Voice", path: "voice" },
  { key: "preview", label: "Preview", path: "preview" },
  { key: "export", label: "Export", path: "export" },
] as const;

export function ProjectStepper({ projectId }: { projectId: string }) {
  const location = useLocation();
  const currentIdx = STEPS.findIndex((s) => location.pathname.endsWith(`/${s.path}`));

  return (
    <div className="border-t border-border bg-background">
      <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-6 py-3">
        {STEPS.map((step, i) => {
          const active = i === currentIdx;
          const done = currentIdx > i;
          return (
            <Link
              key={step.key}
              to={`/projects/${projectId}/${step.path}` as string}
              className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : done
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
                  active
                    ? "bg-primary-foreground/20"
                    : done
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {step.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
