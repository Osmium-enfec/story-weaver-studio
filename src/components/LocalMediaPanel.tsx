import { useCallback, useEffect, useMemo, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Search, Sparkles, HardDrive, Loader2, RefreshCw, Palette } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { IconColorEditor } from "@/components/IconColorEditor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const IMAGE_EXT_RE = /\.(gif|png|jpe?g|webp|avif|svg)$/i;
const LOTTIE_EXT_RE = /\.(json|lottie)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a)$/i;

type LocalKind = "image" | "lottie" | "video" | "audio" | "component" | "3d";

interface LocalItem {
  id: string;
  componentId?: string;
  name: string;
  category: string;
  kind: LocalKind;
  provider: string;
  assetType?: string | null;
  contentType?: string | null;
  url?: string | null;
  thumbnail?: string | null;
  tags: string[];
}

type FilterId = "all" | "lottie" | "icon" | "iconscout" | "freepik" | "3d" | "image" | "video" | "audio" | "component" | "upload";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "lottie", label: "Lottie" },
  { id: "icon", label: "Icon" },
  { id: "iconscout", label: "Iconscout" },
  { id: "freepik", label: "Freepik" },
  { id: "3d", label: "3D" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "component", label: "Component" },
  { id: "upload", label: "Upload" },
];

function matchesFilter(item: LocalItem, f: FilterId): boolean {
  if (f === "all") return true;
  if (f === "icon") return item.provider === "iconify";
  if (f === "iconscout") return item.provider === "iconscout" && item.assetType !== "3d";
  if (f === "freepik") return item.provider === "freepik";
  if (f === "upload") return item.provider === "upload";
  if (f === "3d") return item.assetType === "3d";
  if (f === "image") return item.kind === "image" && item.assetType !== "3d";
  return item.kind === f;
}

function classifyExt(name: string): LocalKind {
  if (IMAGE_EXT_RE.test(name)) return "image";
  if (LOTTIE_EXT_RE.test(name)) return "lottie";
  if (VIDEO_EXT_RE.test(name)) return "video";
  if (AUDIO_EXT_RE.test(name)) return "audio";
  return "image";
}

const PAGE_SIZE = 20;

export function LocalMediaPanel() {
  const [items, setItems] = useState<LocalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");
  const [page, setPage] = useState(1);
  const [recolorTargetId, setRecolorTargetId] = useState<string | null>(null);

  function isRecolorable(it: LocalItem): boolean {
    if (!it.componentId) return false;
    if (it.provider === "iconify" || it.provider === "iconify-custom") return true;
    if ((it.provider === "freepik" || it.provider === "freepik-custom") &&
        (it.assetType === "icon" || it.assetType === "vector" || it.contentType === "image/svg+xml")) {
      return true;
    }
    return /\.svg(\?|$)/i.test(it.url ?? "");
  }

  useEffect(() => {
    setPage(1);
  }, [query, activeFilter]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
        const fetchAllComps = async () => {
          const pageSize = 1000;
          const all: any[] = [];
          for (let from = 0; ; from += pageSize) {
            const { data, error } = await supabase
              .from("animation_components")
              .select("id,name,slug,category,tags,lottie_url,thumbnail_url,video_url,provider,default_props")
              .order("created_at", { ascending: false })
              .range(from, from + pageSize - 1);
            if (error) throw error;
            const batch = data ?? [];
            all.push(...batch);
            if (batch.length < pageSize) break;
          }
          return { data: all };
        };
        const [uploadsRes, compsRes] = await Promise.all([
          supabase.storage.from("lottie-uploads").list("", {
            limit: 1000,
            sortBy: { column: "created_at", order: "desc" },
          }),
          fetchAllComps(),
        ]);

        const uploads: LocalItem[] = (uploadsRes.data ?? []).map((f) => {
          const { data } = supabase.storage.from("lottie-uploads").getPublicUrl(f.name);
          const kind = classifyExt(f.name);
          return {
            id: `upload:${f.name}`,
            name: f.name.replace(/\.[^.]+$/i, ""),
            category: kind === "image" ? "Images" : kind === "lottie" ? "Lottie" : kind === "video" ? "Videos" : "Audio",
            kind,
            provider: "upload",
            url: data.publicUrl,
            thumbnail: kind === "image" ? data.publicUrl : null,
            tags: [],
          };
        });

        const comps: LocalItem[] = (compsRes.data ?? []).map((c: any) => {
          const assetType: string | null = c.default_props?.asset_type ?? null;
          const contentType: string | null = c.default_props?.content_type ?? null;
          const kind: LocalKind = c.lottie_url
            ? "lottie"
            : c.video_url
            ? "video"
            : assetType === "3d"
            ? "3d"
            : c.thumbnail_url
            ? "image"
            : "component";
          return {
            id: `comp:${c.id}`,
            componentId: c.id,
            name: c.name,
            category: c.category || "Components",
            kind,
            provider: c.provider || "internal",
            assetType,
            contentType,
            url: c.lottie_url || c.video_url || c.thumbnail_url,
            thumbnail: c.thumbnail_url,
            tags: c.tags ?? [],
          };
        });

      setItems([...uploads, ...comps]);
    } catch (err) {
      console.error("Failed to load local media", err);
      setItems([]);
      setError("Could not load local media. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const counts = useMemo(() => {
    const map = {} as Record<FilterId, number>;
    for (const f of FILTERS) map[f.id] = 0;
    map.all = items.length;
    for (const it of items) {
      for (const f of FILTERS) {
        if (f.id !== "all" && matchesFilter(it, f.id)) map[f.id] += 1;
      }
    }
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (!matchesFilter(it, activeFilter)) return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q) ||
        it.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [items, query, activeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <HardDrive className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">Local Media</h2>
        <span className="text-xs text-muted-foreground">
          Offline assets stored in your library — no external API calls.
        </span>
      </div>

      <div className="flex max-w-xl gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              const value = e.target.value;
              setQuery(value);
              if (value.trim()) setActiveFilter("all");
            }}
            placeholder="Search local media…"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadItems()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = activeFilter === f.id;
          const count = counts[f.id] ?? 0;
          return (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-accent"
              }`}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No local media matches your filters.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {paged.map((it) => (
            <div
              key={it.id}
              className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-primary hover:shadow-sm"
            >
              <div className="relative aspect-square bg-muted/40">
                {(it.kind === "image" || it.kind === "3d") && it.thumbnail ? (
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
                {isRecolorable(it) && (
                  <button
                    type="button"
                    onClick={() => setRecolorTargetId(it.componentId!)}
                    className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium opacity-0 transition-opacity hover:bg-primary hover:text-primary-foreground group-hover:opacity-100"
                    title="Recolor icon"
                  >
                    <Palette className="h-3 w-3" /> Recolor
                  </button>
                )}
              </div>
              <div className="px-2 py-1.5">
                <div className="line-clamp-1 text-xs font-medium">{it.name}</div>
                <div className="line-clamp-1 text-[10px] text-muted-foreground">{it.category}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={recolorTargetId !== null} onOpenChange={(o) => { if (!o) setRecolorTargetId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Recolor icon</DialogTitle>
            <DialogDescription>
              Edit colors and save the result as a library copy.
            </DialogDescription>
          </DialogHeader>
          <IconColorEditor componentId={recolorTargetId} />
        </DialogContent>
      </Dialog>

      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–
            {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="rounded-md border border-border px-2 py-1 hover:bg-accent disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-2">
              Page {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="rounded-md border border-border px-2 py-1 hover:bg-accent disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
