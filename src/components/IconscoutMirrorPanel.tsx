import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Download, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { bulkMirrorIconscout } from "@/server/iconscout-mirror.functions";
import { supabase } from "@/integrations/supabase/client";

const PRESETS = [
  "education", "math", "science", "coding", "computer",
  "rocket", "lightbulb", "graph", "physics", "chemistry",
  "biology", "history", "language", "writing", "reading",
];

interface CategoryStat {
  category: string;
  count: number;
}

export function IconscoutMirrorPanel() {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const [mode, setMode] = useState<"mp4" | "palettes" | "icon" | "illustration" | "3d">("mp4");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [stats, setStats] = useState<CategoryStat[]>([]);
  const [lastResult, setLastResult] = useState<
    | { ok: true; query: string; mirrored: number; skipped: number; errors: number }
    | { ok: false; query: string; message: string }
    | null
  >(null);

  const refreshStats = useCallback(async () => {
    const { data, count } = await supabase
      .from("animation_components")
      .select("category", { count: "exact" })
      .eq("provider", "iconscout");
    setTotal(count ?? 0);
    const map = new Map<string, number>();
    (data ?? []).forEach((r: { category: string | null }) => {
      const k = r.category || "Uncategorized";
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    setStats(
      Array.from(map.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
    );
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  async function mirrorOne(q: string) {
    setRunning(true);
    setLog((l) => [`Mirroring "${q}"…`, ...l]);
    try {
      const res = await bulkMirrorIconscout({
        data: { query: q, category: q, limit, mode },
      });
      const success = res.mirrored > 0;
      const msg = `${success ? "✓" : "⚠"} "${q}": +${res.mirrored} mirrored, ${res.skipped} skipped${res.errors.length ? `, ${res.errors.length} errors` : ""}`;
      setLog((l) => [msg, ...l]);
      setLastResult({
        ok: true,
        query: q,
        mirrored: res.mirrored,
        skipped: res.skipped,
        errors: res.errors.length,
      });
      if (success) {
        toast.success(`Mirrored ${res.mirrored} "${q}" assets locally`);
      } else {
        toast.warning(`No new assets mirrored for "${q}" (${res.skipped} skipped)`);
      }
      await refreshStats();
    } catch (e) {
      const message = (e as Error).message;
      setLog((l) => [`✗ "${q}": ${message}`, ...l]);
      setLastResult({ ok: false, query: q, message });
      toast.error(`Failed to mirror "${q}": ${message}`);
    } finally {
      setRunning(false);
    }
  }

  async function mirrorAllPresets() {
    for (const p of PRESETS) {
      // eslint-disable-next-line no-await-in-loop
      await mirrorOne(p);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 rounded-xl border border-border bg-card p-4 lg:col-span-2">
        <div>
          <h3 className="font-semibold">Mirror Iconscout to local library</h3>
          <p className="text-xs text-muted-foreground">
            Downloads animations to your own storage. After mirroring, search uses local
            assets — no external API calls at runtime.
          </p>
        </div>

        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search term (e.g. rocket)"
            className="h-9"
          />
          <Input
            type="number"
            min={1}
            max={100}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 20)}
            className="h-9 w-20"
          />
          <Button
            onClick={() => query.trim() && mirrorOne(query.trim())}
            disabled={running || !query.trim()}
            className="h-9 gap-1"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Mirror
          </Button>
        </div>

        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-2 text-xs">
          <span className="font-medium text-muted-foreground">Mirror as:</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="mirror-mode"
              checked={mode === "mp4"}
              onChange={() => setMode("mp4")}
              disabled={running}
            />
            <span>MP4 only <span className="text-muted-foreground">(1 per item, fixed colors)</span></span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="mirror-mode"
              checked={mode === "palettes"}
              onChange={() => setMode("palettes")}
              disabled={running}
            />
            <span>Lottie + 5 color palettes <span className="text-muted-foreground">(5 per item)</span></span>
          </label>
        </div>

        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => mirrorOne(p)}
              disabled={running}
              className="rounded-full border border-border bg-background px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>

        <Button variant="outline" onClick={mirrorAllPresets} disabled={running} className="w-full">
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Mirror all preset categories ({PRESETS.length} × {limit})
        </Button>

        {lastResult && (
          <div
            className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
              lastResult.ok && (lastResult as { mirrored: number }).mirrored > 0
                ? "border-green-500/40 bg-green-500/10"
                : lastResult.ok
                  ? "border-yellow-500/40 bg-yellow-500/10"
                  : "border-destructive/40 bg-destructive/10"
            }`}
          >
            {lastResult.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="flex-1">
              {lastResult.ok ? (
                <>
                  <div className="font-medium">
                    {lastResult.mirrored > 0
                      ? `Yes — mirrored ${lastResult.mirrored} new asset${lastResult.mirrored === 1 ? "" : "s"} for "${lastResult.query}"`
                      : `No new assets for "${lastResult.query}"`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {lastResult.skipped} skipped (already mirrored or no preview)
                    {lastResult.errors > 0 ? `, ${lastResult.errors} errors` : ""}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-medium">Mirror failed for "{lastResult.query}"</div>
                  <div className="text-xs text-muted-foreground">{lastResult.message}</div>
                </>
              )}
            </div>
          </div>
        )}

        {log.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-md bg-muted/40 p-2 font-mono text-[11px]">
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
      </div>

      <aside className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Mirrored locally
          </div>
          <div className="text-3xl font-bold">{total}</div>
          <div className="text-xs text-muted-foreground">
            across {stats.length} categor{stats.length === 1 ? "y" : "ies"}
          </div>
        </div>
        <div className="border-t border-border pt-2">
          <div className="mb-2 text-xs font-medium text-muted-foreground">By category</div>
          {stats.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              Nothing mirrored yet. Pick a preset or search above.
            </div>
          ) : (
            <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1 text-sm">
              {stats.map((s) => (
                <li
                  key={s.category}
                  className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted/50"
                >
                  <span className="truncate">{s.category}</span>
                  <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                    {s.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
