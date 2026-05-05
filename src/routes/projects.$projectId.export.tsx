import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";
import { Download } from "lucide-react";

export const Route = createFileRoute("/projects/$projectId/export")({
  component: () => (
    <PlaceholderPage
      icon={<Download className="h-8 w-8" />}
      title="Export"
      description="Export your video to MP4 with subtitles. Browser-side draft export and the production render adapter (Remotion / Cloud Run / Shotstack) are wired up in the next pass."
      bullets={[
        "MP4 720p / 1080p / 4K",
        "Burn-in subtitles or export SRT",
        "Project JSON + render plan",
        "Render job tracking with status and logs",
      ]}
    />
  ),
});
