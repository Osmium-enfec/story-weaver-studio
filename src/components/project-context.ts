import { createContext, useContext } from "react";
import type { Project } from "@/lib/db-types";

export interface ProjectContextValue {
  project: Project;
  reload: () => Promise<void>;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used inside a ProjectContext provider");
  return ctx;
}
