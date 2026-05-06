import { useCallback, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Upload, Trash2, Image as ImageIcon, Video, Sparkles } from "lucide-react";

type MediaKind = "image" | "video" | "animation";

interface MediaItem {
  url: string;
  kind: MediaKind;
  name: string;
}

interface ThemeFont {
  family: string;
  url?: string;
}

export interface ThemeData {
  name: string;
  background?: MediaItem;
  fonts: {
    heading?: ThemeFont;
    subheading?: ThemeFont;
    paragraph?: ThemeFont;
  };
  card?: MediaItem;
}

const EMPTY_THEME: ThemeData = { name: "", fonts: {} };

function detectKind(file: File): MediaKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.name.toLowerCase().endsWith(".lottie") || file.name.toLowerCase().endsWith(".json")) return "animation";
  return "image";
}

function MediaUploader({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: MediaItem;
  onChange: (m: MediaItem | undefined) => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleUpload = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const kind = detectKind(file);
        const path = `themes/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage.from("scene-backgrounds").upload(path, file, {
          cacheControl: "3600",
          upsert: false,
        });
        if (error) throw error;
        const { data } = supabase.storage.from("scene-backgrounds").getPublicUrl(path);
        onChange({ url: data.publicUrl, kind, name: file.name });
        toast.success(`${label} uploaded`);
      } catch (e) {
        toast.error(`Upload failed: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [label, onChange]
  );

  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      {value ? (
        <div className="relative overflow-hidden rounded-md border border-border bg-muted/30">
          <div className="flex h-28 items-center justify-center">
            {value.kind === "image" && <img src={value.url} alt={value.name} className="h-full w-full object-cover" />}
            {value.kind === "video" && (
              <video src={value.url} className="h-full w-full object-cover" muted loop autoPlay playsInline />
            )}
            {value.kind === "animation" && <DotLottieReact src={value.url} autoplay loop />}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1">
            <span className="truncate text-xs text-muted-foreground">{value.name}</span>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onChange(undefined)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <label className="flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/20 text-xs text-muted-foreground hover:bg-muted/40">
          <Upload className="h-4 w-4" />
          <span>{busy ? "Uploading..." : "Upload image, video, or animation"}</span>
          <div className="flex gap-2 opacity-60">
            <ImageIcon className="h-3 w-3" />
            <Video className="h-3 w-3" />
            <Sparkles className="h-3 w-3" />
          </div>
          <input
            type="file"
            className="hidden"
            accept="image/*,video/*,.lottie,.json,application/json"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
              e.currentTarget.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}

function FontField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: ThemeFont;
  onChange: (f: ThemeFont | undefined) => void;
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
        onChange({ family, url: data.publicUrl });
        toast.success(`${label} font uploaded`);
      } catch (e) {
        toast.error(`Upload failed: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [label, onChange]
  );

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <Label className="text-xs font-medium">{label}</Label>
      <Input
        placeholder="Font family (e.g. Inter)"
        value={value?.family ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? { family: e.target.value, url: value?.url } : undefined)
        }
        className="h-8 text-xs"
      />
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border px-2 py-2 text-xs text-muted-foreground hover:bg-muted/40">
        <Upload className="h-3.5 w-3.5" />
        <span>{busy ? "Uploading..." : value?.url ? "Replace font file" : "Upload .ttf / .otf / .woff"}</span>
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
      {value?.family && (
        <p className="truncate text-[11px] text-muted-foreground" style={{ fontFamily: value.family }}>
          Preview: {value.family}
        </p>
      )}
    </div>
  );
}

export function ThemeBuilder() {
  const [theme, setTheme] = useState<ThemeData>(EMPTY_THEME);
  const [savedThemes, setSavedThemes] = useState<ThemeData[]>([]);

  const saveTheme = () => {
    if (!theme.name.trim()) {
      toast.error("Please give your theme a name");
      return;
    }
    setSavedThemes((prev) => [...prev, theme]);
    setTheme(EMPTY_THEME);
    toast.success("Theme saved");
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <div className="space-y-2">
        <Label className="text-xs">Theme name</Label>
        <Input
          placeholder="My theme"
          value={theme.name}
          onChange={(e) => setTheme((t) => ({ ...t, name: e.target.value }))}
          className="h-8 text-xs"
        />
      </div>

      <Tabs defaultValue="background" className="mt-4 flex flex-col">
        <TabsList className="grid grid-cols-3">
          <TabsTrigger value="background" className="text-xs">Background</TabsTrigger>
          <TabsTrigger value="fonts" className="text-xs">Fonts</TabsTrigger>
          <TabsTrigger value="cards" className="text-xs">Cards</TabsTrigger>
        </TabsList>

        <TabsContent value="background" className="mt-3">
          <MediaUploader
            label="Background"
            value={theme.background}
            onChange={(m) => setTheme((t) => ({ ...t, background: m }))}
          />
        </TabsContent>

        <TabsContent value="fonts" className="mt-3 space-y-3">
          <FontField
            label="Heading"
            value={theme.fonts.heading}
            onChange={(f) => setTheme((t) => ({ ...t, fonts: { ...t.fonts, heading: f } }))}
          />
          <FontField
            label="Sub-heading"
            value={theme.fonts.subheading}
            onChange={(f) => setTheme((t) => ({ ...t, fonts: { ...t.fonts, subheading: f } }))}
          />
          <FontField
            label="Paragraph"
            value={theme.fonts.paragraph}
            onChange={(f) => setTheme((t) => ({ ...t, fonts: { ...t.fonts, paragraph: f } }))}
          />
        </TabsContent>

        <TabsContent value="cards" className="mt-3">
          <MediaUploader
            label="Card"
            value={theme.card}
            onChange={(m) => setTheme((t) => ({ ...t, card: m }))}
          />
        </TabsContent>
      </Tabs>

      <Button size="sm" className="mt-4" onClick={saveTheme}>
        Save theme
      </Button>

      {savedThemes.length > 0 && (
        <div className="mt-6 space-y-2">
          <Label className="text-xs">Your themes</Label>
          <div className="space-y-2">
            {savedThemes.map((t, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs">
                <span className="truncate">{t.name}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => setSavedThemes((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
