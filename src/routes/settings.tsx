import { createFileRoute } from "@tanstack/react-router";
import { Settings as SettingsIcon } from "lucide-react";

export const Route = createFileRoute("/settings")({ component: Settings });

function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">Workspace and app preferences.</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <SettingsIcon className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold">Workspace</h2>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Workspace ID</dt>
            <dd className="font-mono">default_workspace</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Authentication</dt>
            <dd>Disabled (internal use)</dd>
          </div>
        </dl>
      </div>
      <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
        TODO: Theme management, brand defaults, AI provider settings, and (future) authentication will live here.
      </div>
    </div>
  );
}
