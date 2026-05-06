import { useRef, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Image as ImageIcon, Sparkles, Upload, Link as LinkIcon, Palette, Loader2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type SceneBackground =
  | { type: "color"; value: string }
  | { type: "gradient"; value: string }
  | { type: "image"; value: string }
  | { type: "lottie"; value: string };

interface Props {
  value: SceneBackground;
  onChange: (bg: SceneBackground) => void;
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

// Curated free animated backgrounds (LottieFiles public CDN)
const ANIMATED_BGS: { name: string; url: string }[] = [
  { name: "Particles", url: "https://lottie.host/4f1a4d2e-1b76-4c66-9a76-9a3b6a1aa90f/3pP1nWk1Lh.lottie" },
  { name: "Waves", url: "https://assets10.lottiefiles.com/packages/lf20_jcikwtux.json" },
  { name: "Bubbles", url: "https://assets2.lottiefiles.com/packages/lf20_ystsffqy.json" },
  { name: "Confetti", url: "https://assets1.lottiefiles.com/packages/lf20_obhph3sh.json" },
  { name: "Stars", url: "https://assets9.lottiefiles.com/packages/lf20_rwq6ciql.json" },
  { name: "Grid Glow", url: "https://assets3.lottiefiles.com/packages/lf20_kkflmtur.json" },
];

export function BackgroundPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const lottieRef = useRef<HTMLInputElement>(null);

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
      setOpen(false);
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
    setOpen(false);
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
                  onClick={() => { onChange({ type: "color", value: c }); setOpen(false); }}
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
                  onClick={() => { onChange({ type: "gradient", value: g }); setOpen(false); }}
                  className="aspect-video rounded-md border border-border transition hover:ring-2 hover:ring-primary"
                  style={{ background: g }}
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="animated" className="mt-3">
            <div className="grid grid-cols-3 gap-2">
              {ANIMATED_BGS.map((bg) => (
                <button
                  key={bg.url}
                  onClick={() => { onChange({ type: "lottie", value: bg.url }); setOpen(false); }}
                  className="overflow-hidden rounded-md border border-border bg-muted/30 transition hover:ring-2 hover:ring-primary"
                >
                  <div className="aspect-video">
                    <DotLottieReact src={bg.url} loop autoplay style={{ width: "100%", height: "100%" }} />
                  </div>
                  <div className="px-1 py-0.5 text-[10px] text-muted-foreground">{bg.name}</div>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Animated backgrounds are mirrored at render time.
            </p>
          </TabsContent>

          <TabsContent value="upload" className="mt-3 space-y-2">
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              disabled={uploading}
              onClick={() => imgRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
              Upload image (JPG/PNG)
            </Button>
            <input
              ref={imgRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f, "image"); }}
            />
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              disabled={uploading}
              onClick={() => lottieRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Upload Lottie (.json/.lottie)
            </Button>
            <input
              ref={lottieRef}
              type="file"
              accept=".json,.lottie,application/json"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f, "lottie"); }}
            />
            <div className="flex gap-1 pt-1">
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste image or Lottie URL"
                className="h-8 text-xs"
              />
              <Button size="sm" className="h-8 px-2" onClick={applyUrl}>
                <LinkIcon className="h-3 w-3" />
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
          <span className="text-[11px] text-muted-foreground">
            Current: <span className="font-medium">{value.type}</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs"
            onClick={() => { onChange({ type: "color", value: "#ffffff" }); setOpen(false); }}
          >
            <X className="h-3 w-3" /> Reset
          </Button>
        </div>
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
  return null;
}
