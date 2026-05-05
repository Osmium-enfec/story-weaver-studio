import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";
import { Mic } from "lucide-react";

export const Route = createFileRoute("/projects/$projectId/voice")({
  component: () => (
    <PlaceholderPage
      icon={<Mic className="h-8 w-8" />}
      title="Voice"
      description="Upload voiceover audio per screen, generate AI voice from narration, and auto-sync subtitles. Coming in the next build pass."
      bullets={[
        "Upload one full voiceover or per-screen audio",
        "Waveform display and trim",
        "Auto-sync scenes from transcript",
        "Generate and export SRT subtitles",
      ]}
    />
  ),
});
