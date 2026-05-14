import { useEffect, useRef, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Search, Upload, Link as LinkIcon, Loader2, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  searchAllAnimations,
  uploadLottieFile,
  fromUrl,
  mirrorExternalResult,
  type AnimationResult,
} from "@/lib/animation-providers";

interface Props {
  initialQuery?: string;
  onSelect: (a: AnimationResult) => void;
}

type ProviderFilter = "all" | "lottie" | "iconscout" | "iconify" | "unsplash" | "freepik" | "internal" | "upload";

const FILTERS: { id: ProviderFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "lottie", label: "Lottie" },
  { id: "iconscout", label: "Iconscout" },
  { id: "iconify", label: "Iconify" },
  { id: "unsplash", label: "Unsplash" },
  { id: "freepik", label: "Freepik" },
  { id: "internal", label: "Local" },
  { id: "upload", label: "Uploads" },
];

export function AnimationSearchPanel({ initialQuery = "", onSelect }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<AnimationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [filter, setFilter] = useState<ProviderFilter>("all");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchAllAnimations({ query, limit: 30 });
        if (!cancelled) setResults(r);
      } catch (e) {
        if (!cancelled) toast.error((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const r = await uploadLottieFile(f);
      toast.success("Uploaded");
      onSelect(r);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function handleUrlAdd() {
    if (!urlInput.trim()) return;
    onSelect(fromUrl(urlInput.trim()));
    setUrlInput("");
  }

  const counts = {
    lottie: results.filter((r) => r.provider === "lottie").length,
    iconscout: results.filter((r) => r.provider === "iconscout").length,
    iconify: results.filter((r) => r.provider === "iconify").length,
    unsplash: results.filter((r) => r.provider === "unsplash").length,
    freepik: results.filter((r) => r.provider === "freepik").length,
    internal: results.filter((r) => r.provider === "internal").length,
    upload: results.filter((r) => r.provider === "upload").length,
  };

  async function handleSelect(r: AnimationResult) {
    if (r.provider === "iconify" || r.provider === "unsplash" || r.provider === "freepik") {
      const cachedUrl = await mirrorExternalResult(r);
      if (cachedUrl) {
        onSelect({ ...r, thumbnail_url: cachedUrl, video_url: cachedUrl });
        return;
      }
    }
    onSelect(r);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search animations…"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 flex-1 gap-1 text-xs"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-3 w-3" /> Upload
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.lottie,application/json,.gif,.png,.jpg,.jpeg,.webp,.avif,.svg,image/*"
            className="hidden"
            onChange={handleUpload}
          />
        </div>
        <div className="flex gap-1">
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste Lottie .json URL"
            className="h-7 text-xs"
          />
          <Button type="button" size="sm" className="h-7 px-2" onClick={handleUrlAdd}>
            <LinkIcon className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            const count = f.id === "all" ? results.length : (counts[f.id as keyof typeof counts] ?? 0);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50"
                }`}
              >
                {f.label} {count}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {!loading && results.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            No matches. Try another keyword, paste a URL, or upload a file.
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {results
            .filter((r) => filter === "all" || r.provider === filter)
            .map((r) => (
            <button
              key={r.id}
              onClick={() => handleSelect(r)}
              className="group flex flex-col items-stretch overflow-hidden rounded-lg border border-border bg-background text-left transition-all hover:border-primary hover:shadow-sm"
            >
              <div className="relative aspect-square bg-muted/40">
                {(r.provider === "image" || r.provider === "iconify" || r.provider === "unsplash" || r.provider === "freepik") && r.thumbnail_url ? (
                  <img
                    src={r.thumbnail_url}
                    alt={r.name}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                ) : r.provider === "iconscout" && r.video_url ? (
                  <video
                    src={r.video_url}
                    autoPlay
                    loop
                    muted
                    playsInline
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                ) : r.provider !== "internal" && r.lottie_url ? (
                  <DotLottieReact
                    src={r.lottie_url}
                    loop
                    autoplay
                    style={{ width: "100%", height: "100%" }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                )}
                <span className="absolute left-1 top-1 rounded bg-background/80 px-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                  {r.provider}
                </span>
              </div>
              <div className="px-2 py-1.5">
                <div className="line-clamp-1 text-xs font-medium">{r.name}</div>
                {r.category && (
                  <div className="line-clamp-1 text-[10px] text-muted-foreground">{r.category}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
