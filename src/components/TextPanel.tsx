import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { Type, Palette } from "lucide-react";

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

export const DEFAULT_ROLES: TextRoles = {
  heading: { family: "Inter", size: 48, weight: 700, lineHeight: 1.2, color: "#0f172a" },
  subheading: { family: "Inter", size: 24, weight: 600, lineHeight: 1.3, color: "#0f172a" },
  paragraph: { family: "Inter", size: 16, weight: 400, lineHeight: 1.4, color: "#334155" },
};

const STORAGE_KEY = "text-roles-v1";

export function loadTextRoles(): TextRoles {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ROLES;
    const parsed = JSON.parse(raw);
    return {
      heading: { ...DEFAULT_ROLES.heading, ...parsed.heading },
      subheading: { ...DEFAULT_ROLES.subheading, ...parsed.subheading },
      paragraph: { ...DEFAULT_ROLES.paragraph, ...parsed.paragraph },
    };
  } catch {
    return DEFAULT_ROLES;
  }
}

export function saveTextRoles(r: TextRoles) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch { /* noop */ }
}

export function TextRoleEditor({
  label,
  value,
  onChange,
  onInsert,
}: {
  label: string;
  value: TextRoleStyle;
  onChange: (v: TextRoleStyle) => void;
  onInsert?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const path = `themes/fonts/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("scene-backgrounds").upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from("scene-backgrounds").getPublicUrl(path);
      const family = file.name.replace(/\.[^.]+$/, "");
      onChange({ ...value, family, url: data.publicUrl });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">{label}</Label>
        {onInsert && (
          <Button size="sm" variant="secondary" className="h-7 gap-1 text-[11px]" onClick={onInsert}>
            <Type className="h-3 w-3" /> Add to canvas
          </Button>
        )}
      </div>
      <Input
        placeholder="Font family"
        value={value.family}
        onChange={(e) => onChange({ ...value, family: e.target.value })}
        className="h-8 text-xs"
      />
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
        <Label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Palette className="h-3 w-3" /> Color
        </Label>
        <input
          type="color"
          value={value.color || "#0f172a"}
          onChange={(e) => onChange({ ...value, color: e.target.value })}
          className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
        />
        <Input value={value.color || "#0f172a"}
          onChange={(e) => onChange({ ...value, color: e.target.value })}
          className="h-7 flex-1 text-xs" />
      </div>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40">
        <span>{busy ? "Uploading..." : value.url ? "Replace font file" : "Upload .ttf / .otf / .woff"}</span>
        <input type="file" className="hidden" accept=".ttf,.otf,.woff,.woff2,font/*" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = ""; }} />
      </label>
      <p className="truncate text-xs text-muted-foreground"
        style={{ fontFamily: value.family, color: value.color, fontWeight: value.weight }}>
        Preview: {value.family}
      </p>
    </div>
  );
}

export function TextPanel({ onInsert }: { onInsert: (role: TextRole, style: TextRoleStyle) => void }) {
  const [roles, setRoles] = useState<TextRoles>(DEFAULT_ROLES);

  useEffect(() => { setRoles(loadTextRoles()); }, []);

  const update = (role: TextRole, v: TextRoleStyle) => {
    const next = { ...roles, [role]: v };
    setRoles(next);
    saveTextRoles(next);
  };

  return (
    <div className="space-y-3 p-3">
      <p className="text-[11px] text-muted-foreground">
        Click "Add to canvas" to insert as an editable text box. Words in your script bind the same way as animations.
      </p>
      <TextRoleEditor label="Heading" value={roles.heading}
        onChange={(v) => update("heading", v)}
        onInsert={() => onInsert("heading", roles.heading)} />
      <TextRoleEditor label="Sub-heading" value={roles.subheading}
        onChange={(v) => update("subheading", v)}
        onInsert={() => onInsert("subheading", roles.subheading)} />
      <TextRoleEditor label="Paragraph" value={roles.paragraph}
        onChange={(v) => update("paragraph", v)}
        onInsert={() => onInsert("paragraph", roles.paragraph)} />
    </div>
  );
}
