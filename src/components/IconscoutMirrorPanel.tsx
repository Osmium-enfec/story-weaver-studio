import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { bulkMirrorIconscout } from "@/server/iconscout-mirror.functions";

const PRESETS = [
  "education", "math", "science", "coding", "computer",
  "rocket", "lightbulb", "graph", "physics", "chemistry",
  "biology", "history", "language", "writing", "reading",
];

export function IconscoutMirrorPanel() {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  async function mirrorOne(q: string) {
    setRunning(true);
    setLog((l) => [`Mirroring "${q}"…`, ...l]);
    try {
      const res = await bulkMirrorIconscout({
        data: { query: q, category: q, limit },
      });
      const msg = `✓ "${q}": +${res.mirrored} mirrored, ${res.skipped} skipped${res.errors.length ? `, ${res.errors.length} errors` : ""}`;
      setLog((l) => [msg, ...l]);
      toast.success(msg);
    } catch (e) {
      const msg = `✗ "${q}": ${(e as Error).message}`;
      setLog((l) => [msg, ...l]);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  }

  async function mirrorAllPresets() {
    for (const p of PRESETS) {
      // sequential to avoid hammering the API
      // eslint-disable-next-line no-await-in-loop
      await mirrorOne(p);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
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

      {log.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-md bg-muted/40 p-2 font-mono text-[11px]">
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
