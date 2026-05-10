import { useEffect, useState } from "react";
import { ChevronLeft, Flame, Type as TypeIcon, Image as ImageIcon, LayoutGrid, Palette, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  FIREBASE_BACKGROUNDS,
  FIREBASE_CARDS,
  FIREBASE_COLORS,
  FIREBASE_TEXT_ROLES,
  applyFirebaseFonts,
  backgroundFromAsset,
  type FirebaseAsset,
} from "@/lib/firebase-theme";
import { ensureGoogleFont, type TextRole, type TextRoleStyle } from "@/components/TextPanel";
import type { SceneBackground } from "@/components/BackgroundPicker";

interface Props {
  onBack: () => void;
  onApplyBackground?: (bg: SceneBackground) => void;
  onInsertMedia?: (item: { url: string; kind: "image" | "video" | "animation"; name: string }) => void;
  onInsertText?: (role: TextRole, style: TextRoleStyle) => void;
  onApplyColor?: (hex: string) => void;
}

function MediaTile({ item, onClick, label }: { item: FirebaseAsset; onClick?: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={label ?? item.name}
      className="group/thumb overflow-hidden rounded-md border border-border bg-muted/30 hover:ring-2 hover:ring-primary disabled:cursor-default"
    >
      <div className="flex h-24 w-full items-center justify-center overflow-hidden bg-[conic-gradient(at_50%_50%,#fafafa,#f1f5f9)]">
        <img src={item.url} alt={item.name} className="max-h-full max-w-full object-contain" />
      </div>
      <div className="truncate border-t border-border px-2 py-1 text-[11px] text-muted-foreground">
        {label ?? item.name}
      </div>
    </button>
  );
}

export function FirebaseThemePanel({
  onBack,
  onApplyBackground,
  onInsertMedia,
  onInsertText,
  onApplyColor,
}: Props) {
  useEffect(() => { ensureGoogleFont("Poppins"); }, []);
  const [copied, setCopied] = useState<string | null>(null);

  const handleColor = (hex: string) => {
    if (onApplyColor) {
      onApplyColor(hex);
      toast.success(`Applied ${hex} to selection`);
    } else {
      void navigator.clipboard?.writeText(hex);
      toast.success(`Copied ${hex}`);
    }
    setCopied(hex);
    setTimeout(() => setCopied((c) => (c === hex ? null : c)), 1200);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-[#ffb404] via-[#f67e00] to-[#e13900] text-white">
            <Flame className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold leading-none">Firebase</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Built-in theme · Poppins · warm palette</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="default"
          className="ml-auto h-7 text-[11px]"
          onClick={() => {
            applyFirebaseFonts();
            if (onApplyBackground) onApplyBackground(backgroundFromAsset(FIREBASE_BACKGROUNDS[0]));
            toast.success("Firebase theme applied");
          }}
        >
          Apply theme
        </Button>
      </div>

      {/* Colors */}
      <section className="mb-4">
        <Label className="mb-2 flex items-center gap-1.5 text-xs"><Palette className="h-3.5 w-3.5" /> Colors</Label>
        <div className="grid grid-cols-4 gap-2">
          {FIREBASE_COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => handleColor(c.hex)}
              title={`${c.name} · ${c.hex}`}
              className="group flex flex-col items-stretch overflow-hidden rounded-md border border-border transition hover:ring-2 hover:ring-primary"
            >
              <span
                className="relative flex h-12 items-center justify-center"
                style={{ background: c.hex }}
              >
                {copied === c.hex && (
                  <Check
                    className="h-4 w-4 drop-shadow"
                    style={{ color: c.hex === "#ffffff" ? "#0f172a" : "#ffffff" }}
                  />
                )}
              </span>
              <span className="px-1 py-0.5 text-center text-[9px] font-mono text-muted-foreground">{c.hex}</span>
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {onApplyColor ? "Click a swatch to apply to the selected element." : "Click a swatch to copy."}
        </p>
      </section>

      {/* Fonts */}
      <section className="mb-4">
        <Label className="mb-2 flex items-center gap-1.5 text-xs"><TypeIcon className="h-3.5 w-3.5" /> Fonts · Poppins</Label>
        <div className="space-y-2">
          {(Object.entries(FIREBASE_TEXT_ROLES) as [TextRole, TextRoleStyle][]).map(([role, style]) => {
            const previewSize = role === "heading" ? 30 : role === "subheading" ? 18 : 14;
            const sample = role === "heading" ? "Main heading" : role === "subheading" ? "Sub heading" : "Body text · paragraph";
            return (
              <button
                key={role}
                type="button"
                onClick={() => onInsertText?.(role, style)}
                disabled={!onInsertText}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-gradient-to-br from-[#ffb404]/15 via-[#f67e00]/15 to-[#e13900]/15 px-3 py-3 text-left transition hover:border-primary disabled:cursor-default"
              >
                <span
                  className="truncate"
                  style={{ fontFamily: "Poppins", fontWeight: style.weight, fontSize: previewSize, color: "#0f172a", lineHeight: 1.1 }}
                >
                  {sample}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {style.size}px / {style.weight}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Click to add to canvas. "Apply theme" sets these as the project defaults.
        </p>
      </section>

      {/* Backgrounds */}
      <section className="mb-4">
        <Label className="mb-2 flex items-center gap-1.5 text-xs"><ImageIcon className="h-3.5 w-3.5" /> Backgrounds</Label>
        <div className="grid grid-cols-2 gap-2">
          {FIREBASE_BACKGROUNDS.map((bg) => (
            <MediaTile
              key={bg.id}
              item={bg}
              onClick={onApplyBackground ? () => onApplyBackground(backgroundFromAsset(bg)) : undefined}
            />
          ))}
        </div>
      </section>

      {/* Cards */}
      <section className="mb-2">
        <Label className="mb-2 flex items-center gap-1.5 text-xs"><LayoutGrid className="h-3.5 w-3.5" /> Card layouts</Label>
        <div className="grid grid-cols-2 gap-2">
          {FIREBASE_CARDS.map((card) => (
            <div key={card.id} className="space-y-1">
              <MediaTile
                item={card}
                onClick={onInsertMedia ? () => onInsertMedia({ url: card.url, kind: card.kind, name: card.name }) : undefined}
                label={card.name}
              />
              {onApplyBackground && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 w-full text-[10px]"
                  onClick={() => onApplyBackground(backgroundFromAsset(card))}
                >
                  Use as background
                </Button>
              )}
            </div>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Click the tile to add as an overlay, or use as a background.
        </p>
      </section>
    </div>
  );
}
