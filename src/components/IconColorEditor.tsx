import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Copy, Palette } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getIconSvg, saveRecoloredIcon } from "@/server/icon-recolor.functions";

interface Props {
  componentId: string | null;
  /** Live-preview callback fired whenever colors change. Receives a data: URL of the recolored SVG. */
  onPreviewSvg?: (dataUrl: string) => void;
}

interface IconData {
  id: string;
  name: string;
  provider: string;
  svg: string;
  colors: string[];
  has_current_color: boolean;
}

function applyMapToSvg(
  svg: string,
  map: Record<string, string>,
  currentColor: string | null,
): string {
  let out = svg;
  for (const [from, to] of Object.entries(map)) {
    if (!from || !to) continue;
    const safeFrom = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(safeFrom, "gi"), to);
  }
  if (currentColor) out = out.replace(/currentColor/gi, currentColor);
  return out;
}

/**
 * Inline sidebar panel for per-color SVG recoloring of an iconify asset.
 * Calls onPreviewSvg with a data: URL each time the user adjusts a color —
 * the parent persists that onto the canvas element in real time.
 */
export function IconColorEditor({ componentId, onPreviewSvg }: Props) {
  const loadFn = useServerFn(getIconSvg);
  const saveFn = useServerFn(saveRecoloredIcon);
  const [data, setData] = useState<IconData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [colorMap, setColorMap] = useState<Record<string, string>>({});
  const [currentColor, setCurrentColor] = useState<string>("#111111");

  useEffect(() => {
    if (!componentId) {
      setData(null);
      setColorMap({});
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadFn({ data: { component_id: componentId } })
      .then((res) => {
        if (cancelled) return;
        setData(res as IconData);
        const initial: Record<string, string> = {};
        for (const c of res.colors) initial[c] = c;
        setColorMap(initial);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [componentId, loadFn]);

  const previewSvg = useMemo(() => {
    if (!data) return "";
    return applyMapToSvg(data.svg, colorMap, data.has_current_color ? currentColor : null);
  }, [data, colorMap, currentColor]);

  const previewDataUrl = useMemo(() => {
    if (!previewSvg) return "";
    return `data:image/svg+xml;utf8,${encodeURIComponent(previewSvg)}`;
  }, [previewSvg]);

  // Live-preview push to canvas. Ref the callback so a new inline parent
  // function doesn't retrigger this effect (which would infinite loop).
  const onPreviewSvgRef = useRef(onPreviewSvg);
  useEffect(() => { onPreviewSvgRef.current = onPreviewSvg; }, [onPreviewSvg]);
  useEffect(() => {
    const cb = onPreviewSvgRef.current;
    if (!cb || !data || !previewDataUrl) return;
    const changedColors = Object.entries(colorMap).some(
      ([from, to]) => from.toLowerCase() !== to.toLowerCase(),
    );
    const changedCurrent = data.has_current_color && currentColor.toLowerCase() !== "#111111";
    if (!changedColors && !changedCurrent) return;
    cb(previewDataUrl);
  }, [previewDataUrl, data, colorMap, currentColor]);

  async function handleSaveCopy() {
    if (!data) return;
    setSaving(true);
    try {
      await saveFn({
        data: {
          component_id: data.id,
          color_map: colorMap,
          current_color: data.has_current_color ? currentColor : null,
          save_as_copy: true,
        },
      });
      toast.success("Saved as a recolored copy in your library");
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (!componentId) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <Palette className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          SVG colors
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
          {error}
        </div>
      ) : data ? (
        <>
          {data.has_current_color && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground">Primary color</div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={currentColor}
                  onChange={(e) => setCurrentColor(e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
                />
                <input
                  type="text"
                  value={currentColor}
                  onChange={(e) => setCurrentColor(e.target.value)}
                  className="h-7 w-24 rounded-md border border-border bg-background px-2 font-mono text-[11px]"
                />
              </div>
            </div>
          )}

          {data.colors.length > 0 && (
            <div className="space-y-1.5">
              {data.colors.map((orig) => {
                const val = colorMap[orig] ?? orig;
                return (
                  <div key={orig} className="flex items-center gap-2">
                    <span
                      className="h-6 w-6 shrink-0 rounded border border-border"
                      style={{ background: orig }}
                      title={`Original ${orig}`}
                    />
                    <span className="text-muted-foreground">→</span>
                    <input
                      type="color"
                      value={val}
                      onChange={(e) =>
                        setColorMap((m) => ({ ...m, [orig]: e.target.value }))
                      }
                      className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent"
                    />
                    <input
                      type="text"
                      value={val}
                      onChange={(e) =>
                        setColorMap((m) => ({ ...m, [orig]: e.target.value }))
                      }
                      className="h-7 flex-1 rounded-md border border-border bg-background px-2 font-mono text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => setColorMap((m) => ({ ...m, [orig]: orig }))}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      reset
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {data.colors.length === 0 && !data.has_current_color && (
            <div className="rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
              No editable colors detected in this SVG.
            </div>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={handleSaveCopy}
            disabled={saving}
            className="w-full gap-1"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />}
            Save as library copy
          </Button>
        </>
      ) : null}
    </div>
  );
}
