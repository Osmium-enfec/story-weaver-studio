import { useEffect, useMemo, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Search, Sparkles, HardDrive, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

const IMAGE_EXT_RE = /\.(gif|png|jpe?g|webp|avif|svg)$/i;
const LOTTIE_EXT_RE = /\.(json|lottie)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a)$/i;

type LocalKind = "image" | "lottie" | "video" | "audio" | "component";

interface LocalItem {
  id: string;
  name: string;
  category: string;
  kind: LocalKind;
  url?: string | null;
  thumbnail?: string | null;
  tags: string[];
}

function classifyExt(name: string): LocalKind {
  if (IMAGE_EXT_RE.test(name)) return "image";
  if (LOTTIE_EXT_RE.test(name)) return "lottie";
  if (VIDEO_EXT_RE.test(name)) return "video";
  if (AUDIO_EXT_RE.test(name)) return "audio";
  return "image";
}

export function LocalMediaPanel() {
  const [items, setItems] = useState<LocalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [uploadsRes, compsRes] = await Promise.all([
          supabase.storage.from("lottie-uploads").list("", {
            limit: 1000,
            sortBy: { column: "created_at", order: "desc" },
          }),
          supabase
            .from("animation_components")
            .select("id,name,slug,category,tags,lottie_url,thumbnail_url,provider")
            .neq("provider", "iconscout")
            .limit(1000),
        ]);

        const uploads: LocalItem[] = (uploadsRes.data ?? []).map((f) => {
          const { data } = supabase.storage.from("lottie-uploads").getPublicUrl(f.name);
          const kind = classifyExt(f.name);
          return {
            id: `upload:${f.name}`,
            name: f.name.replace(/\.[^.]+$/i, ""),
            category: kind === "image" ? "Images" : kind === "lottie" ? "Lottie" : kind === "video" ? "Videos" : "Audio",
            kind,
            url: data.publicUrl,
            thumbnail: kind === "image" ? data.publicUrl : null,
            tags: [],
          };
        });

        const comps: LocalItem[] = (compsRes.data ?? []).map((c) => ({
          id: `comp:${c.id}`,
          name: c.name,
          category: c.category || "Components",
          kind: c.lottie_url ? "lottie" : "component",
          url: c.lottie_url,
          thumbnail: c.thumbnail_url,
          tags: c.tags ?? [],
        }));

        setItems([...uploads, ...comps]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) map.set(it.category, (map.get(it.category) ?? 0) + 1);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (activeCategory !== "all" && it.category !== activeCategory) return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q) ||
        it.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [items, query, activeCategory]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <HardDrive className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">Local Media</h2>
        <span className="text-xs text-muted-foreground">
          Offline assets stored in your library — no external API calls.
        </span>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search local media…"
          className="h-9 pl-8 text-sm"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCategory("all")}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            activeCategory === "all"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background hover:bg-accent"
          }`}
        >
          All ({items.length})
        </button>
        {categories.map(([cat, count]) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              activeCategory === cat
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-accent"
            }`}
          >
            {cat} ({count})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No local media matches your filters.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((it) => (
            <div
              key={it.id}
              className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-primary hover:shadow-sm"
            >
              <div className="relative aspect-square bg-muted/40">
                {it.kind === "image" && it.thumbnail ? (
                  <img src={it.thumbnail} alt={it.name} className="h-full w-full object-contain" />
                ) : it.kind === "lottie" && it.url ? (
                  <DotLottieReact src={it.url} loop autoplay style={{ width: "100%", height: "100%" }} />
                ) : it.kind === "video" && it.url ? (
                  <video src={it.url} muted loop playsInline className="h-full w-full object-contain" />
                ) : it.kind === "audio" && it.url ? (
                  <div className="flex h-full w-full items-center justify-center p-2">
                    <audio src={it.url} controls className="w-full" />
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Sparkles className="h-6 w-6 text-primary" />
                  </div>
                )}
                <span className="absolute left-1 top-1 rounded bg-background/80 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                  {it.kind}
                </span>
              </div>
              <div className="px-2 py-1.5">
                <div className="line-clamp-1 text-xs font-medium">{it.name}</div>
                <div className="line-clamp-1 text-[10px] text-muted-foreground">{it.category}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
