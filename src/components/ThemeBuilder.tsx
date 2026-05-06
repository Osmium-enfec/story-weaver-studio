import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Upload, Trash2, Image as ImageIcon, Video, Sparkles, ChevronLeft, Plus, Palette, Type } from "lucide-react";
import type { SceneBackground } from "@/components/BackgroundPicker";
import type { TextRole, TextRoleStyle } from "@/components/TextPanel";
import { TextRoleEditor } from "@/components/TextPanel";

type MediaKind = "image" | "video" | "animation";

interface MediaItem {
  id: string;
  url: string;
  kind: MediaKind;
  name: string;
}

interface ThemeFont {
  family: string;
  url?: string;
  size: number; // px
  weight?: number;
  lineHeight?: number;
  color?: string;
}

export interface ThemeData {
  id: string;
  name: string;
  backgrounds: MediaItem[];
  fonts: {
    heading: ThemeFont;
    subheading: ThemeFont;
    paragraph: ThemeFont;
  };
  cards: MediaItem[];
  components: MediaItem[];
}

const defaultFont = (size: number): ThemeFont => ({ family: "Inter", size, weight: 400, lineHeight: 1.4 });

function newTheme(name = "Untitled theme"): ThemeData {
  return {
    id: crypto.randomUUID(),
    name,
    backgrounds: [],
    cards: [],
    components: [],
    fonts: {
      heading: { ...defaultFont(48), weight: 700, lineHeight: 1.2 },
      subheading: { ...defaultFont(24), weight: 600, lineHeight: 1.3 },
      paragraph: defaultFont(16),
    },
  };
}

// Migrate legacy single-item shape to arrays
function normalize(t: Partial<ThemeData> & { background?: MediaItem; card?: MediaItem; component?: MediaItem }): ThemeData {
  const base = newTheme(t.name ?? "Untitled");
  return {
    id: t.id ?? base.id,
    name: t.name ?? base.name,
    backgrounds: t.backgrounds ?? (t.background ? [{ ...t.background, id: crypto.randomUUID() }] : []),
    cards: t.cards ?? (t.card ? [{ ...t.card, id: crypto.randomUUID() }] : []),
    components: t.components ?? (t.component ? [{ ...t.component, id: crypto.randomUUID() }] : []),
    fonts: {
      heading: { ...base.fonts.heading, ...(t.fonts?.heading ?? {}) },
      subheading: { ...base.fonts.subheading, ...(t.fonts?.subheading ?? {}) },
      paragraph: { ...base.fonts.paragraph, ...(t.fonts?.paragraph ?? {}) },
    },
  };
}

function detectKind(file: File): MediaKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.name.toLowerCase().endsWith(".lottie") || file.name.toLowerCase().endsWith(".json")) return "animation";
  return "image";
}

function MediaThumb({ item, onRemove }: { item: MediaItem; onRemove: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-muted/30">
      <div className="flex h-24 items-center justify-center">
        {item.kind === "image" && <img src={item.url} alt={item.name} className="h-full w-full object-cover" />}
        {item.kind === "video" && (
          <video src={item.url} className="h-full w-full object-cover" muted loop autoPlay playsInline />
        )}
        {item.kind === "animation" && <DotLottieReact src={item.url} autoplay loop />}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1">
        <span className="truncate text-[11px] text-muted-foreground">{item.name}</span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function MediaGallery({
  label,
  items,
  onChange,
}: {
  label: string;
  items: MediaItem[];
  onChange: (items: MediaItem[]) => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleUpload = useCallback(
    async (files: FileList) => {
      setBusy(true);
      try {
        const uploaded: MediaItem[] = [];
        for (const file of Array.from(files)) {
          const kind = detectKind(file);
          const path = `themes/${Date.now()}-${file.name}`;
          const { error } = await supabase.storage.from("scene-backgrounds").upload(path, file, {
            cacheControl: "3600",
            upsert: false,
          });
          if (error) throw error;
          const { data } = supabase.storage.from("scene-backgrounds").getPublicUrl(path);
          uploaded.push({ id: crypto.randomUUID(), url: data.publicUrl, kind, name: file.name });
        }
        onChange([...items, ...uploaded]);
        toast.success(`${uploaded.length} ${label.toLowerCase()} added`);
      } catch (e) {
        toast.error(`Upload failed: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [label, items, onChange]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label} ({items.length})</Label>
      </div>
      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {items.map((item) => (
            <MediaThumb
              key={item.id}
              item={item}
              onRemove={() => onChange(items.filter((i) => i.id !== item.id))}
            />
          ))}
        </div>
      )}
      <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/20 text-xs text-muted-foreground hover:bg-muted/40">
        <Upload className="h-4 w-4" />
        <span>{busy ? "Uploading..." : `Add ${label.toLowerCase()} (multiple)`}</span>
        <div className="flex gap-2 opacity-60">
          <ImageIcon className="h-3 w-3" />
          <Video className="h-3 w-3" />
          <Sparkles className="h-3 w-3" />
        </div>
        <input
          type="file"
          multiple
          className="hidden"
          accept="image/*,video/*,.lottie,.json,application/json"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.length) void handleUpload(e.target.files);
            e.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}

function FontField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ThemeFont;
  onChange: (f: ThemeFont) => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleUpload = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const path = `themes/fonts/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage.from("scene-backgrounds").upload(path, file, {
          cacheControl: "3600",
          upsert: false,
        });
        if (error) throw error;
        const { data } = supabase.storage.from("scene-backgrounds").getPublicUrl(path);
        const family = file.name.replace(/\.[^.]+$/, "");
        onChange({ ...value, family, url: data.publicUrl });
        toast.success(`${label} font uploaded`);
      } catch (e) {
        toast.error(`Upload failed: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [label, value, onChange]
  );

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <Label className="text-xs font-medium">{label}</Label>
      <Input
        placeholder="Font family (e.g. Inter)"
        value={value.family}
        onChange={(e) => onChange({ ...value, family: e.target.value })}
        className="h-8 text-xs"
      />
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">Size (px)</Label>
          <Input
            type="number"
            min={8}
            max={200}
            value={value.size}
            onChange={(e) => onChange({ ...value, size: Number(e.target.value) || 16 })}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Weight</Label>
          <Input
            type="number"
            min={100}
            max={900}
            step={100}
            value={value.weight ?? 400}
            onChange={(e) => onChange({ ...value, weight: Number(e.target.value) || 400 })}
            className="h-8 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Line ht</Label>
          <Input
            type="number"
            min={0.8}
            max={3}
            step={0.1}
            value={value.lineHeight ?? 1.4}
            onChange={(e) => onChange({ ...value, lineHeight: Number(e.target.value) || 1.4 })}
            className="h-8 text-xs"
          />
        </div>
      </div>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border px-2 py-2 text-xs text-muted-foreground hover:bg-muted/40">
        <Upload className="h-3.5 w-3.5" />
        <span>{busy ? "Uploading..." : value.url ? "Replace font file" : "Upload .ttf / .otf / .woff"}</span>
        <input
          type="file"
          className="hidden"
          accept=".ttf,.otf,.woff,.woff2,font/*"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUpload(f);
            e.currentTarget.value = "";
          }}
        />
      </label>
      {value.family && (
        <p
          className="truncate text-muted-foreground"
          style={{
            fontFamily: value.family,
            fontSize: Math.min(value.size, 22),
            fontWeight: value.weight,
            lineHeight: value.lineHeight,
          }}
        >
          Preview: {value.family}
        </p>
      )}
    </div>
  );
}

function ThemeEditor({
  theme,
  onChange,
  onBack,
}: {
  theme: ThemeData;
  onChange: (t: ThemeData) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input
          value={theme.name}
          onChange={(e) => onChange({ ...theme, name: e.target.value })}
          className="h-8 text-xs"
          placeholder="Theme name"
        />
      </div>

      <Tabs defaultValue="background" className="flex flex-col">
        <TabsList className="grid grid-cols-4">
          <TabsTrigger value="background" className="text-[11px]">BG</TabsTrigger>
          <TabsTrigger value="fonts" className="text-[11px]">Fonts</TabsTrigger>
          <TabsTrigger value="cards" className="text-[11px]">Cards</TabsTrigger>
          <TabsTrigger value="components" className="text-[11px]">Comps</TabsTrigger>
        </TabsList>

        <TabsContent value="background" className="mt-3">
          <MediaGallery
            label="Backgrounds"
            items={theme.backgrounds}
            onChange={(items) => onChange({ ...theme, backgrounds: items })}
          />
        </TabsContent>

        <TabsContent value="fonts" className="mt-3 space-y-3">
          <FontField
            label="Heading"
            value={theme.fonts.heading}
            onChange={(f) => onChange({ ...theme, fonts: { ...theme.fonts, heading: f } })}
          />
          <FontField
            label="Sub-heading"
            value={theme.fonts.subheading}
            onChange={(f) => onChange({ ...theme, fonts: { ...theme.fonts, subheading: f } })}
          />
          <FontField
            label="Paragraph"
            value={theme.fonts.paragraph}
            onChange={(f) => onChange({ ...theme, fonts: { ...theme.fonts, paragraph: f } })}
          />
        </TabsContent>

        <TabsContent value="cards" className="mt-3">
          <MediaGallery
            label="Cards"
            items={theme.cards}
            onChange={(items) => onChange({ ...theme, cards: items })}
          />
        </TabsContent>

        <TabsContent value="components" className="mt-3">
          <MediaGallery
            label="Components"
            items={theme.components}
            onChange={(items) => onChange({ ...theme, components: items })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function ThemeBuilder() {
  const [themes, setThemes] = useState<ThemeData[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("user_themes")
        .select("id, name, data")
        .order("created_at", { ascending: true });
      if (!error && data) {
        setThemes(
          data.map((r) =>
            normalize({ id: r.id, name: r.name, ...((r.data as Partial<ThemeData>) ?? {}) })
          )
        );
      }
      setLoading(false);
    })();
  }, []);

  const persist = async (t: ThemeData) => {
    const { id, name, ...rest } = t;
    await supabase.from("user_themes").upsert({ id, name, data: rest as never });
  };

  const active = themes.find((t) => t.id === activeId) ?? null;

  const updateActive = (next: ThemeData) => {
    setThemes((prev) => prev.map((t) => (t.id === next.id ? next : t)));
    void persist(next);
  };

  const addTheme = async () => {
    const t = newTheme(`Theme ${themes.length + 1}`);
    setThemes((prev) => [...prev, t]);
    setActiveId(t.id);
    await persist(t);
  };

  const removeTheme = async (id: string) => {
    setThemes((prev) => prev.filter((t) => t.id !== id));
    if (activeId === id) setActiveId(null);
    await supabase.from("user_themes").delete().eq("id", id);
  };

  if (active) {
    return <ThemeEditor theme={active} onChange={updateActive} onBack={() => setActiveId(null)} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <Label className="mb-2 text-xs">Saved themes</Label>
      {themes.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          No themes yet. Create one below.
        </div>
      ) : (
        <div className="space-y-2">
          {themes.map((t) => (
            <div
              key={t.id}
              className="group flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs hover:bg-muted/40"
            >
              <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setActiveId(t.id)}>
                <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate">{t.name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {t.backgrounds.length}bg · {t.cards.length}c · {t.components.length}cmp
                </span>
              </button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 group-hover:opacity-100"
                onClick={() => removeTheme(t.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button size="sm" variant="outline" className="mt-4 gap-2" onClick={addTheme}>
        <Plus className="h-3.5 w-3.5" />
        Add new theme
      </Button>
    </div>
  );
}
