import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { Settings2, Palette } from "lucide-react";
import { FONT_PAIRS, type FontPair } from "@/lib/font-pairs";
import type { AnimationBlockContent } from "@/components/AnimationBlock";

export interface TextRoleStyle {
  family: string;
  url?: string;
  size: number;
  weight?: number;
  lineHeight?: number;
  color?: string;
}

export type TextRole = "heading" | "subheading" | "paragraph";

export interface TextRoles {
  heading: TextRoleStyle;
  subheading: TextRoleStyle;
  paragraph: TextRoleStyle;
}

// Curated Google Fonts list available out of the box.
export const GOOGLE_FONTS = [
  "Poppins", "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Raleway", "Nunito",
  "Oswald", "Source Sans 3", "Work Sans", "Plus Jakarta Sans", "DM Sans", "Manrope",
  "Quicksand", "Rubik", "Mulish", "Karla", "Playfair Display", "Merriweather", "Lora",
  "PT Serif", "EB Garamond", "Cormorant Garamond", "Bebas Neue", "Anton", "Archivo Black",
  "Pacifico", "Caveat", "Dancing Script", "Shadows Into Light", "Permanent Marker",
  "JetBrains Mono", "Fira Code", "IBM Plex Sans", "IBM Plex Serif", "IBM Plex Mono",
] as const;

const loadedGoogleFonts = new Set<string>();
export function ensureGoogleFont(family: string) {
  if (!family || loadedGoogleFonts.has(family)) return;
  if (!GOOGLE_FONTS.includes(family as typeof GOOGLE_FONTS[number])) return;
  loadedGoogleFonts.add(family);
  const id = `gf-${family.replace(/\s+/g, "-")}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&display=swap`;
  document.head.appendChild(link);
}

export const DEFAULT_ROLES: TextRoles = {
  heading: { family: "Poppins", size: 48, weight: 700, lineHeight: 1.2, color: "#0f172a" },
  subheading: { family: "Poppins", size: 24, weight: 600, lineHeight: 1.3, color: "#0f172a" },
  paragraph: { family: "Poppins", size: 16, weight: 400, lineHeight: 1.4, color: "#334155" },
};

const STORAGE_KEY = "text-roles-v2";

export function loadTextRoles(): TextRoles {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      Object.values(DEFAULT_ROLES).forEach((r) => ensureGoogleFont(r.family));
      return DEFAULT_ROLES;
    }
    const parsed = JSON.parse(raw);
    const merged = {
      heading: { ...DEFAULT_ROLES.heading, ...parsed.heading },
      subheading: { ...DEFAULT_ROLES.subheading, ...parsed.subheading },
      paragraph: { ...DEFAULT_ROLES.paragraph, ...parsed.paragraph },
    };
    Object.values(merged).forEach((r) => ensureGoogleFont(r.family));
    return merged;
  } catch {
    return DEFAULT_ROLES;
  }
}

export function saveTextRoles(r: TextRoles) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch { /* noop */ }
}

// ---------- Style editor (popover) ----------
function RoleStyleEditor({
  value,
  onChange,
}: {
  value: TextRoleStyle;
  onChange: (v: TextRoleStyle) => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { ensureGoogleFont(value.family); }, [value.family]);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const path = `themes/fonts/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("scene-backgrounds").upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from("scene-backgrounds").getPublicUrl(path);
      const family = file.name.replace(/\.[^.]+$/, "");
      const styleId = `cf-${family.replace(/\s+/g, "-")}`;
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `@font-face{font-family:'${family}';src:url('${data.publicUrl}');font-display:swap;}`;
        document.head.appendChild(style);
      }
      onChange({ ...value, family, url: data.publicUrl });
    } finally {
      setBusy(false);
    }
  };

  const isCustom = !!value.url || !GOOGLE_FONTS.includes(value.family as typeof GOOGLE_FONTS[number]);

  return (
    <div className="space-y-2">
      <Select
        value={isCustom ? "__custom__" : value.family}
        onValueChange={(v) => { if (v !== "__custom__") onChange({ ...value, family: v, url: undefined }); }}
      >
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Font" /></SelectTrigger>
        <SelectContent className="max-h-72">
          {GOOGLE_FONTS.map((f) => (
            <SelectItem key={f} value={f} style={{ fontFamily: f }} onMouseEnter={() => ensureGoogleFont(f)}>
              {f}
            </SelectItem>
          ))}
          {isCustom && <SelectItem value="__custom__">{value.family} (custom)</SelectItem>}
        </SelectContent>
      </Select>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">Size</Label>
          <Input type="number" min={8} max={200} value={value.size}
            onChange={(e) => onChange({ ...value, size: Number(e.target.value) || 16 })}
            className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Weight</Label>
          <Input type="number" min={100} max={900} step={100} value={value.weight ?? 400}
            onChange={(e) => onChange({ ...value, weight: Number(e.target.value) || 400 })}
            className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Line ht</Label>
          <Input type="number" min={0.8} max={3} step={0.1} value={value.lineHeight ?? 1.4}
            onChange={(e) => onChange({ ...value, lineHeight: Number(e.target.value) || 1.4 })}
            className="h-8 text-xs" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Label className="flex items-center gap-1 text-[10px] text-muted-foreground"><Palette className="h-3 w-3" /> Color</Label>
        <input type="color" value={value.color || "#0f172a"}
          onChange={(e) => onChange({ ...value, color: e.target.value })}
          className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent" />
        <Input value={value.color || "#0f172a"}
          onChange={(e) => onChange({ ...value, color: e.target.value })}
          className="h-7 flex-1 text-xs" />
      </div>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40">
        <span>{busy ? "Uploading…" : value.url ? "Replace custom font" : "Upload .ttf / .otf / .woff"}</span>
        <input type="file" className="hidden" accept=".ttf,.otf,.woff,.woff2,font/*" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = ""; }} />
      </label>
    </div>
  );
}

// ---------- Canva-style default text style tile ----------
function DefaultStyleTile({
  role, style, onInsert, onChange, sample,
}: {
  role: TextRole;
  style: TextRoleStyle;
  onInsert: () => void;
  onChange: (v: TextRoleStyle) => void;
  sample: string;
}) {
  return (
    <div
      onClick={onInsert}
      className="group relative cursor-pointer rounded-2xl border border-border bg-card px-4 py-5 transition hover:border-primary hover:shadow-md"
    >
      <div
        className="truncate"
        style={{
          fontFamily: style.family,
          fontWeight: style.weight ?? 400,
          fontSize: Math.min(style.size, role === "heading" ? 36 : role === "subheading" ? 22 : 16),
          color: style.color,
          lineHeight: 1.1,
        }}
      >
        {sample}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            title="Edit default style"
            className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-muted"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="end" onClick={(e) => e.stopPropagation()}>
          <p className="mb-2 text-xs font-semibold capitalize">{role} default</p>
          <RoleStyleEditor value={style} onChange={onChange} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ---------- Font pair card ----------
function PairCard({ pair, onInsert }: { pair: FontPair; onInsert: () => void }) {
  useEffect(() => { ensureGoogleFont(pair.heading.family); ensureGoogleFont(pair.body.family); }, [pair]);
  const isDarkSwatch = (pair.swatch || "").startsWith("#1") || (pair.swatch || "").startsWith("#0");
  return (
    <button
      onClick={onInsert}
      className="group flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border border-border p-3 text-center transition hover:border-primary hover:shadow-md"
      style={{ background: pair.swatch || "#f5f5f4" }}
    >
      <div
        className="leading-none"
        style={{
          fontFamily: pair.heading.family,
          fontWeight: pair.heading.weight,
          color: pair.heading.color,
          fontStyle: pair.heading.italic ? "italic" : "normal",
          letterSpacing: pair.heading.letterSpacing ? `${pair.heading.letterSpacing}px` : undefined,
          textTransform: pair.heading.transform === "uppercase" ? "uppercase" : "none",
          fontSize: 28,
        }}
      >
        {pair.label}
      </div>
      <div
        className="mt-1 leading-none"
        style={{
          fontFamily: pair.body.family,
          fontWeight: pair.body.weight,
          color: pair.body.color,
          fontStyle: pair.body.italic ? "italic" : "normal",
          letterSpacing: pair.body.letterSpacing ? `${pair.body.letterSpacing}px` : undefined,
          textTransform: pair.body.transform === "uppercase" ? "uppercase" : "none",
          fontSize: 12,
        }}
      >
        {pair.vibe}
      </div>
      <span className={`mt-2 text-[10px] uppercase tracking-wide ${isDarkSwatch ? "text-white/60" : "text-muted-foreground"}`}>
        Click to add
      </span>
    </button>
  );
}

// ---------- Text animation control (for selected element) ----------
const ANIM_OPTIONS: { value: NonNullable<NonNullable<AnimationBlockContent["text_animation"]>["type"]>; label: string }[] = [
  { value: "none",         label: "None" },
  { value: "fade",         label: "Fade in" },
  { value: "slide-up",     label: "Slide up" },
  { value: "slide-left",   label: "Slide left" },
  { value: "slide-right",  label: "Slide right" },
  { value: "scale",        label: "Scale in" },
  { value: "bounce",       label: "Bounce" },
  { value: "typewriter",   label: "Typewriter" },
  { value: "word-reveal",  label: "Word by word" },
];

function TextAnimationControl({
  value,
  onChange,
}: {
  value: AnimationBlockContent["text_animation"];
  onChange: (next: AnimationBlockContent["text_animation"]) => void;
}) {
  const v = value ?? { type: "none" as const, duration: 600, delay: 0, easing: "ease-out" };
  const update = (patch: Partial<NonNullable<AnimationBlockContent["text_animation"]>>) =>
    onChange({ type: v.type, duration: v.duration, delay: v.delay, easing: v.easing, ...patch });
  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Selected text · animation</p>
      <Select value={v.type} onValueChange={(t) => update({ type: t as typeof v.type })}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ANIM_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {v.type !== "none" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">Duration (ms)</Label>
            <Input type="number" min={100} max={5000} step={50} value={v.duration ?? 600}
              onChange={(e) => update({ duration: Number(e.target.value) || 600 })}
              className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Delay (ms)</Label>
            <Input type="number" min={0} max={10000} step={50} value={v.delay ?? 0}
              onChange={(e) => update({ delay: Number(e.target.value) || 0 })}
              className="h-8 text-xs" />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Main panel ----------
export function TextPanel({
  onInsert,
  onInsertPair,
  selectedTextAnimation,
  onChangeSelectedAnimation,
}: {
  onInsert: (role: TextRole, style: TextRoleStyle, text?: string) => void;
  onInsertPair?: (pair: FontPair) => void;
  selectedTextAnimation?: AnimationBlockContent["text_animation"];
  onChangeSelectedAnimation?: (v: AnimationBlockContent["text_animation"]) => void;
}) {
  const [roles, setRoles] = useState<TextRoles>(DEFAULT_ROLES);
  useEffect(() => { setRoles(loadTextRoles()); }, []);

  const update = (role: TextRole, v: TextRoleStyle) => {
    ensureGoogleFont(v.family);
    const next = { ...roles, [role]: v };
    setRoles(next);
    saveTextRoles(next);
  };

  return (
    <div className="space-y-4 p-3">
      {onChangeSelectedAnimation && selectedTextAnimation !== undefined && (
        <TextAnimationControl value={selectedTextAnimation} onChange={onChangeSelectedAnimation} />
      )}

      <div>
        <p className="mb-2 text-sm font-semibold">Default text styles</p>
        <div className="space-y-2">
          <DefaultStyleTile
            role="heading" style={roles.heading} sample="Add a heading"
            onInsert={() => onInsert("heading", roles.heading, "Add a heading")}
            onChange={(v) => update("heading", v)}
          />
          <DefaultStyleTile
            role="subheading" style={roles.subheading} sample="Add a subheading"
            onInsert={() => onInsert("subheading", roles.subheading, "Add a subheading")}
            onChange={(v) => update("subheading", v)}
          />
          <DefaultStyleTile
            role="paragraph" style={roles.paragraph} sample="Add a little bit of body text"
            onInsert={() => onInsert("paragraph", roles.paragraph, "Add a little bit of body text")}
            onChange={(v) => update("paragraph", v)}
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">Font combinations</p>
        <div className="grid grid-cols-2 gap-2">
          {FONT_PAIRS.map((p) => (
            <PairCard key={p.id} pair={p} onInsert={() => onInsertPair?.(p)} />
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Click a combination to add a heading + body pair to the canvas.
        </p>
      </div>
    </div>
  );
}
