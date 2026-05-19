import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, X, Palette, Save, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getIconSvg, saveRecoloredIcon } from "@/server/icon-recolor.functions";

interface Props {
  componentId: string | null;
  onClose: () => void;
  onSaved?: () => void;
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
    // simple but effective in-browser preview replace
    const safeFrom = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(safeFrom, "gi"), to);
  }
  if (currentColor) out = out.replace(/currentColor/gi, currentColor);
  return out;
}

export function IconColorEditor({ componentId, onClose, onSaved }: Props) {
  const loadFn = useServerFn(getIconSvg);
  const saveFn = useServerFn(saveRecoloredIcon);
  const [data, setData] = useState<IconData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [colorMap, setColorMap] = useState<Record<string, string>>({});
  const [currentColor, setCurrentColor] = useState<string>("#111111");
  const [customColors, setCustomColors] = useState<string[]>([]);

  useEffect(() => {
    if (!componentId) {
      setData(null);
      setColorMap({});
      setCustomColors([]);
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

  async function handleSave(saveAsCopy: boolean) {
    if (!data) return;
    setSaving(true);
    try {
      await saveFn({
        data: {
          component_id: data.id,
          color_map: colorMap,
          current_color: data.has_current_color ? currentColor : null,
          save_as_copy: saveAsCopy,
        },
      });
      toast.success(saveAsCopy ? "Saved as a recolored copy" : "Icon updated");
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={componentId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" /> Recolor icon
          </DialogTitle>
          <DialogDescription>
            Edit each color from the source SVG. Save replaces the original, or save a copy.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : data ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-4">
              {data.has_current_color && (
                <div>
                  <div className="mb-1.5 text-xs font-medium">Primary color (currentColor)</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={currentColor}
                      onChange={(e) => setCurrentColor(e.target.value)}
                      className="h-10 w-14 cursor-pointer rounded border border-border bg-transparent"
                    />
                    <input
                      type="text"
                      value={currentColor}
                      onChange={(e) => setCurrentColor(e.target.value)}
                      className="h-9 w-28 rounded-md border border-border bg-background px-2 text-xs font-mono"
                    />
                  </div>
                </div>
              )}

              {data.colors.length > 0 && (
                <div>
                  <div className="mb-1.5 text-xs font-medium">Icon colors</div>
                  <div className="space-y-1.5">
                    {data.colors.map((orig) => {
                      const val = colorMap[orig] ?? orig;
                      return (
                        <div key={orig} className="flex items-center gap-2">
                          <span
                            className="h-7 w-7 rounded border border-border"
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
                            className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
                          />
                          <input
                            type="text"
                            value={val}
                            onChange={(e) =>
                              setColorMap((m) => ({ ...m, [orig]: e.target.value }))
                            }
                            className="h-7 w-24 rounded-md border border-border bg-background px-2 text-xs font-mono"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setColorMap((m) => ({ ...m, [orig]: orig }))
                            }
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            reset
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {data.colors.length === 0 && !data.has_current_color && (
                <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                  No editable colors detected in this SVG.
                </div>
              )}

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-medium">Custom palette</span>
                  <button
                    type="button"
                    onClick={() => setCustomColors((c) => [...c, "#3b82f6"])}
                    className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-[10px] hover:bg-accent"
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {customColors.map((c, i) => (
                    <div key={i} className="relative">
                      <input
                        type="color"
                        value={c}
                        onChange={(e) =>
                          setCustomColors((arr) =>
                            arr.map((v, idx) => (idx === i ? e.target.value : v)),
                          )
                        }
                        className="h-9 w-9 cursor-pointer rounded border border-border bg-transparent"
                        title="Drag onto a color above to apply (click to pick)"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setCustomColors((arr) => arr.filter((_, idx) => idx !== i))
                        }
                        className="absolute -right-1 -top-1 rounded-full bg-background p-0.5 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                  {customColors.length === 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      Add accent swatches for quick reference.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center rounded-lg border border-border bg-[conic-gradient(at_50%_50%,#0001_25%,transparent_0_50%,#0001_0_75%,transparent_0)] bg-[length:16px_16px] p-4">
              {previewDataUrl && (
                <img
                  src={previewDataUrl}
                  alt={data.name}
                  className="max-h-72 w-auto object-contain"
                />
              )}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSave(false)}
            disabled={!data || saving}
            className="gap-1"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Replace original
          </Button>
          <Button onClick={() => handleSave(true)} disabled={!data || saving} className="gap-1">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
            Save as copy
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
