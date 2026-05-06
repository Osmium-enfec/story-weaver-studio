import { useEffect, useRef, useState, useCallback } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Image as ImageIcon, Sparkles, Link as LinkIcon, Palette, Loader2, X, Search, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type SceneBackground =
  | { type: "color"; value: string }
  | { type: "gradient"; value: string }
  | { type: "image"; value: string }
  | { type: "lottie"; value: string }
  | { type: "video"; value: string };

interface Props {
  value: SceneBackground;
  onChange: (bg: SceneBackground) => void;
  inline?: boolean;
  applyToAll?: boolean;
  onApplyToAllChange?: (v: boolean) => void;
}

const COLORS = [
  "#ffffff", "#0f172a", "#111827", "#1e293b",
  "#fef3c7", "#dbeafe", "#dcfce7", "#fce7f3",
  "#fde68a", "#bfdbfe", "#bbf7d0", "#fbcfe8",
];

const GRADIENTS = [
  "linear-gradient(135deg,#667eea 0%,#764ba2 100%)",
  "linear-gradient(135deg,#f093fb 0%,#f5576c 100%)",
  "linear-gradient(135deg,#4facfe 0%,#00f2fe 100%)",
  "linear-gradient(135deg,#43e97b 0%,#38f9d7 100%)",
  "linear-gradient(135deg,#fa709a 0%,#fee140 100%)",
  "linear-gradient(135deg,#30cfd0 0%,#330867 100%)",
  "linear-gradient(135deg,#0f172a 0%,#334155 100%)",
  "linear-gradient(135deg,#fdfbfb 0%,#ebedee 100%)",
];

interface MirroredBg {
  id: string;
  name: string;
  category: string | null;
  lottie_url: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
}

function PickerBody({
  value,
  onChange,
  close,
  applyToAll,
  onApplyToAllChange,
}: {
  value: SceneBackground;
  onChange: (b: SceneBackground) => void;
  close: () => void;
  applyToAll?: boolean;
  onApplyToAllChange?: (v: boolean) => void;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [mirrored, setMirrored] = useState<MirroredBg[]>([]);
  const [loadingMirrored, setLoadingMirrored] = useState(false);
  const [bgQuery, setBgQuery] = useState("");
  const imgRef = useRef<HTMLInputElement>(null);
  const lottieRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingMirrored(true);
    (async () => {
      let q = supabase
        .from("animation_components")
        .select("id, name, category, lottie_url, video_url, thumbnail_url")
        .eq("provider", "iconscout")
        .order("created_at", { ascending: false })
        .limit(200);
      if (bgQuery.trim()) {
        const term = `%${bgQuery.trim()}%`;
        q = q.or(`name.ilike.${term},category.ilike.${term}`);
      }
      const { data, error } = await q;
      if (cancelled) return;
      if (error) toast.error(error.message);
      setMirrored((data ?? []) as MirroredBg[]);
      setLoadingMirrored(false);
    })();
    return () => { cancelled = true; };
  }, [bgQuery]);

  async function uploadFile(file: File, kind: "image" | "lottie") {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || (kind === "image" ? "png" : "json");
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("scene-backgrounds")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from("scene-backgrounds").getPublicUrl(path);
      onChange({ type: kind, value: data.publicUrl });
      toast.success("Background updated");
      close();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function applyUrl() {
    const u = urlInput.trim();
    if (!u) return;
    const isLottie = /\.(json|lottie)(\?|$)/i.test(u);
    onChange({ type: isLottie ? "lottie" : "image", value: u });
    setUrlInput("");
    close();
  }

  return (
    <div>
      <Tabs defaultValue="color">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="color" className="text-xs">Color</TabsTrigger>
          <TabsTrigger value="gradient" className="text-xs">Gradient</TabsTrigger>
          <TabsTrigger value="animated" className="text-xs">Animated</TabsTrigger>
          <TabsTrigger value="upload" className="text-xs">Upload</TabsTrigger>
        </TabsList>

        <TabsContent value="color" className="mt-3">
          <div className="grid grid-cols-6 gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => { onChange({ type: "color", value: c }); close(); }}
                className="aspect-square rounded-md border border-border ring-offset-2 transition hover:ring-2 hover:ring-primary"
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="color"
              value={value.type === "color" ? value.value : "#ffffff"}
              onChange={(e) => onChange({ type: "color", value: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded border border-border"
            />
            <span className="text-xs text-muted-foreground">Custom color</span>
          </div>
        </TabsContent>

        <TabsContent value="gradient" className="mt-3">
          <div className="grid grid-cols-4 gap-2">
            {GRADIENTS.map((g) => (
              <button
                key={g}
                onClick={() => { onChange({ type: "gradient", value: g }); close(); }}
                className="aspect-video rounded-md border border-border transition hover:ring-2 hover:ring-primary"
                style={{ background: g }}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="animated" className="mt-3 space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={bgQuery}
              onChange={(e) => setBgQuery(e.target.value)}
              placeholder="Search mirrored animations…"
              className="h-7 pl-7 text-xs"
            />
          </div>
          <div className="max-h-[320px] overflow-y-auto pr-1">
            {loadingMirrored ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : mirrored.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
                No mirrored animations yet. Mirror some from the Assets page.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {mirrored.map((bg) => {
                  const url = bg.lottie_url || bg.video_url;
                  if (!url) return null;
                  const isVideo = !bg.lottie_url && !!bg.video_url;
                  return (
                    <button
                      key={bg.id}
                      onClick={() => {
                        onChange({ type: isVideo ? "video" : "lottie", value: url });
                        close();
                      }}
                      className="overflow-hidden rounded-md border border-border bg-muted/30 transition hover:ring-2 hover:ring-primary"
                      title={bg.name}
                    >
                      <div className="aspect-video">
                        {isVideo ? (
                          <video src={url} autoPlay loop muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <DotLottieReact src={url} loop autoplay style={{ width: "100%", height: "100%" }} />
                        )}
                      </div>
                      <div className="line-clamp-1 px-1 py-0.5 text-[10px] text-muted-foreground">{bg.name}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="upload" className="mt-3 space-y-2">
          <Button size="sm" variant="outline" className="w-full gap-1.5" disabled={uploading} onClick={() => imgRef.current?.click()}>
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
            Upload image (JPG/PNG)
          </Button>
          <input ref={imgRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f, "image"); }} />
          <Button size="sm" variant="outline" className="w-full gap-1.5" disabled={uploading} onClick={() => lottieRef.current?.click()}>
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Upload Lottie (.json/.lottie)
          </Button>
          <input ref={lottieRef} type="file" accept=".json,.lottie,application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f, "lottie"); }} />
          <div className="flex gap-1 pt-1">
            <Input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="Paste image or Lottie URL" className="h-8 text-xs" />
            <Button size="sm" className="h-8 px-2" onClick={applyUrl}>
              <LinkIcon className="h-3 w-3" />
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {onApplyToAllChange && (
        <label className="mt-3 flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
          <Checkbox checked={!!applyToAll} onCheckedChange={(v) => onApplyToAllChange(!!v)} />
          Apply this background to all pages
        </label>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
        <span className="text-[11px] text-muted-foreground">
          Current: <span className="font-medium">{value.type}</span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          onClick={() => { onChange({ type: "color", value: "#ffffff" }); close(); }}
        >
          <X className="h-3 w-3" /> Reset
        </Button>
      </div>
    </div>
  );
}

export function BackgroundPicker({ value, onChange, inline, applyToAll, onApplyToAllChange }: Props) {
  const [open, setOpen] = useState(false);

  if (inline) {
    return (
      <div className="p-3">
        <PickerBody
          value={value}
          onChange={onChange}
          close={() => {}}
          applyToAll={applyToAll}
          onApplyToAllChange={onApplyToAllChange}
        />
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5">
          <Palette className="h-3.5 w-3.5" />
          Background
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-3" align="start">
        <PickerBody
          value={value}
          onChange={onChange}
          close={() => setOpen(false)}
          applyToAll={applyToAll}
          onApplyToAllChange={onApplyToAllChange}
        />
      </PopoverContent>
    </Popover>
  );
}

export function BackgroundLayer({ background, exportMode = false }: { background: SceneBackground; exportMode?: boolean }) {
  if (background.type === "color") {
    return <div className="absolute inset-0" style={{ background: background.value }} />;
  }
  if (background.type === "gradient") {
    return <div className="absolute inset-0" style={{ background: background.value }} />;
  }
  if (background.type === "image") {
    return (
      <img
        src={background.value}
        alt=""
        crossOrigin="anonymous"
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }
  if (background.type === "lottie") {
    if (exportMode) {
      return <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/10" />;
    }
    return (
      <div className="pointer-events-none absolute inset-0">
        <DotLottieReact src={background.value} loop autoplay style={{ width: "100%", height: "100%" }} />
      </div>
    );
  }
  if (background.type === "video") {
    if (exportMode) {
      return <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/10" />;
    }
    return (
      <video
        src={background.value}
        autoPlay
        loop
        muted
        playsInline
        crossOrigin="anonymous"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
    );
  }
  return null;
}
