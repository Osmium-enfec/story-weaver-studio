import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Download, Search, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  searchFreepik,
  mirrorFreepikSelected,
  FREEPIK_COLORS,
  type FreepikItem,
  type FreepikColor,
} from "@/server/freepik.functions";
import { supabase } from "@/integrations/supabase/client";

const COLOR_HEX: Record<FreepikColor, string> = {
  black: "#111111",
  white: "#ffffff",
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  turquoise: "#14b8a6",
  blue: "#3b82f6",
  lilac: "#a78bfa",
  pink: "#ec4899",
  gray: "#9ca3af",
  brown: "#92400e",
};

type AssetType =
  | "all-images" | "photo" | "vector" | "illustration" | "psd" | "template" | "mockup"
  | "all-videos" | "video" | "footage" | "motion-graphics" | "video-template"
  | "icon" | "3d";

const ASSET_GROUPS: { group: string; options: { id: AssetType; label: string }[] }[] = [
  {
    group: "Images",
    options: [
      { id: "all-images", label: "All Images" },
      { id: "vector", label: "Vectors" },
      { id: "illustration", label: "Illustrations" },
      { id: "photo", label: "Photos" },
      { id: "psd", label: "PSD" },
      { id: "template", label: "Templates" },
      { id: "mockup", label: "Mockups" },
    ],
  },
  {
    group: "Videos",
    options: [
      { id: "all-videos", label: "All Videos" },
      { id: "footage", label: "Footage" },
      { id: "motion-graphics", label: "Motion graphics" },
      { id: "video-template", label: "Video templates" },
    ],
  },
  {
    group: "Other",
    options: [
      { id: "icon", label: "Icons" },
      { id: "3d", label: "3D Models" },
    ],
  },
];

export function FreepikMirrorPanel() {
  const [query, setQuery] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("photo");
  const [color, setColor] = useState<FreepikColor | null>(null);
  const [limit, setLimit] = useState(20);
  const [items, setItems] = useState<FreepikItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [mirroring, setMirroring] = useState(false);
  const [total, setTotal] = useState(0);

  const refreshTotal = useCallback(async () => {
    const { count } = await supabase
      .from("animation_components")
      .select("id", { count: "exact", head: true })
      .eq("provider", "freepik");
    setTotal(count ?? 0);
  }, []);

  useEffect(() => {
    refreshTotal();
  }, [refreshTotal]);

  function toggle(id: string) {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setItems(null);
    setSelected(new Set());
    try {
      const res = await searchFreepik({
        data: {
          query: query.trim(),
          asset_type: assetType,
          color: color ?? undefined,
          limit,
          page: 1,
        },
      });
      if (res.error) {
        toast.error(`Freepik: ${res.error}`);
        setItems([]);
      } else {
        setItems(res.items);
        if (!res.items.length) toast.warning(`No ${assetType} results for "${query}"`);
      }
    } catch (e) {
      toast.error(`Search failed: ${(e as Error).message}`);
    } finally {
      setSearching(false);
    }
  }

  async function mirrorPicked() {
    if (!items) return;
    const picked = items.filter((it) => selected.has(it.id));
    if (!picked.length) {
      toast.warning("Select at least one item");
      return;
    }
    setMirroring(true);
    try {
      const res = await mirrorFreepikSelected({
        data: {
          category: query.trim() || "Freepik",
          items: picked.map((it) => ({
            resource_id: it.id,
            asset_type: it.asset_type,
            name: it.name,
            preview_url: it.preview_url,
            author: it.author ?? undefined,
            palette: it.palette,
          })),
        },
      });
      if (res.errors.length) {
        toast.error(`${res.mirrored} mirrored, ${res.errors.length} failed: ${res.errors[0]}`);
      } else {
        toast.success(`Mirrored ${res.mirrored} (${res.skipped} already cached)`);
      }
      setSelected(new Set());
      await refreshTotal();
    } catch (e) {
      toast.error(`Mirror failed: ${(e as Error).message}`);
    } finally {
      setMirroring(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 rounded-xl border border-border bg-card p-4 lg:col-span-2">
        <div>
          <h3 className="font-semibold">Mirror Freepik to local library</h3>
          <p className="text-xs text-muted-foreground">
            Search Freepik photos, vectors, icons, and videos. Picked items download into your
            storage and become reusable assets.
          </p>
        </div>

        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search term (e.g. rocket)"
            className="h-9"
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
            }}
          />
          <Input
            type="number"
            min={1}
            max={50}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 20)}
            className="h-9 w-20"
          />
          <Button
            onClick={runSearch}
            disabled={searching || !query.trim()}
            className="h-9 gap-1"
          >
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Search
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Type:</span>
          {ASSET_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setAssetType(t.id)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                assetType === t.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:border-primary/50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Color:</span>
          <button
            onClick={() => setColor(null)}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
              color === null
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:border-primary/50"
            }`}
          >
            Any
          </button>
          {FREEPIK_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              title={c}
              className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${
                color === c ? "border-primary scale-110" : "border-border hover:border-primary/60"
              }`}
              style={{ backgroundColor: COLOR_HEX[c] }}
            >
              {color === c && (
                <CheckCircle2
                  className="h-3 w-3"
                  style={{ color: c === "white" || c === "yellow" ? "#000" : "#fff" }}
                />
              )}
            </button>
          ))}
        </div>

        {items !== null && (
          <div className="space-y-2 rounded-md border border-border bg-background p-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="font-medium">
                {items.length} result{items.length === 1 ? "" : "s"}
                {selected.size > 0 ? ` · ${selected.size} selected` : ""}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setSelected(new Set(items.map((it) => it.id)))}
                >
                  Select all
                </button>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </button>
                <Button
                  size="sm"
                  onClick={mirrorPicked}
                  disabled={mirroring || selected.size === 0}
                  className="h-7 gap-1"
                >
                  {mirroring ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  Mirror selected ({selected.size})
                </Button>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setItems(null);
                    setSelected(new Set());
                  }}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid max-h-[480px] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {items.map((it) => {
                const sel = selected.has(it.id);
                return (
                  <button
                    key={it.id}
                    onClick={() => toggle(it.id)}
                    className={`group relative aspect-square overflow-hidden rounded-md border text-left transition ${
                      sel
                        ? "border-primary ring-2 ring-primary"
                        : "border-border hover:border-primary/60"
                    }`}
                    title={it.name}
                  >
                    {it.asset_type === "video" ? (
                      <video
                        src={it.preview_url}
                        muted
                        loop
                        autoPlay
                        playsInline
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <img
                        src={it.preview_url}
                        alt={it.name}
                        loading="lazy"
                        className="h-full w-full object-cover bg-muted/30"
                      />
                    )}
                    <div className="absolute left-1 top-1 rounded bg-background/90 px-1 text-[9px] uppercase tracking-wide">
                      {it.asset_type}
                    </div>
                    {it.license.toLowerCase().includes("premium") && (
                      <div className="absolute right-1 top-1 rounded bg-amber-500/90 px-1 text-[9px] text-white">
                        ★
                      </div>
                    )}
                    {it.palette.length > 0 && (
                      <div className="absolute bottom-1 left-1 flex gap-0.5">
                        {it.palette.slice(0, 5).map((hex, i) => (
                          <span
                            key={i}
                            className="h-2 w-2 rounded-full border border-white/60"
                            style={{ backgroundColor: hex.startsWith("#") ? hex : `#${hex}` }}
                          />
                        ))}
                      </div>
                    )}
                    {sel && (
                      <div className="absolute right-1 bottom-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                        <CheckCircle2 className="h-3 w-3" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Mirrored from Freepik
          </div>
          <div className="text-3xl font-bold">{total}</div>
          <div className="text-xs text-muted-foreground">cached locally</div>
        </div>
        <div className="border-t border-border pt-3 text-xs text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">Notes</p>
          <ul className="list-inside list-disc space-y-1">
            <li>Premium assets (★) need a paid Freepik API plan to download.</li>
            <li>Freepik attribution is required when re-using assets publicly.</li>
            <li>Color filter uses Freepik's fixed palette.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
