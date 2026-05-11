import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Image, Film, Music, Code2, Sparkles, Download, HardDrive } from "lucide-react";
import { IconscoutMirrorPanel } from "@/components/IconscoutMirrorPanel";
import { LocalMediaPanel } from "@/components/LocalMediaPanel";

export const Route = createFileRoute("/assets")({ component: Assets });

const TABS = [
  { key: "local", label: "Local Media", icon: HardDrive },
  { key: "uploaded", label: "Uploaded Media", icon: Image },
  { key: "components", label: "Programming Components", icon: Code2 },
  { key: "lottie", label: "Lottie Library", icon: Sparkles },
  { key: "mirror", label: "Mirror Iconscout", icon: Download },
  { key: "backgrounds", label: "Backgrounds", icon: Film },
  { key: "audio", label: "Audio", icon: Music },
] as const;

interface AnimationComponent {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  tags: string[];
  course_tags: string[];
}

function Assets() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("uploaded");
  const [components, setComponents] = useState<AnimationComponent[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("animation_components").select("*").order("name");
      setComponents((data ?? []) as AnimationComponent[]);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Asset Library</h1>
        <p className="mt-1 text-muted-foreground">
          Reusable visuals, animations, and components for your videos.
        </p>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "mirror" ? (
        <IconscoutMirrorPanel />
      ) : tab === "components" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {components.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <Code2 className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">{c.name}</h3>
              </div>
              <p className="text-xs text-muted-foreground">{c.description}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {c.course_tags.map((t) => (
                  <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-xs">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground">
            Upload support for images, GIFs, videos, audio, Lottie JSON, and dotLottie files is wired in the next build pass.
          </p>
          {/* TODO: implement uploads via Lovable Cloud Storage and react-dropzone */}
        </div>
      )}
    </div>
  );
}
