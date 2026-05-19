import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Palette } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AnimationBlockContent } from "@/components/AnimationBlock";

const ICON_ANIM_OPTIONS: {
  value: NonNullable<NonNullable<AnimationBlockContent["icon_animation"]>["type"]>;
  label: string;
}[] = [
  { value: "none",        label: "None" },
  { value: "fade",        label: "Fade in" },
  { value: "scale",       label: "Scale in" },
  { value: "pop",         label: "Pop" },
  { value: "bounce",      label: "Bounce" },
  { value: "slide-up",    label: "Slide up" },
  { value: "slide-down",  label: "Slide down" },
  { value: "slide-left",  label: "Slide left" },
  { value: "slide-right", label: "Slide right" },
  { value: "spin",        label: "Spin in" },
  { value: "flip",        label: "Flip in" },
  { value: "blur",        label: "Blur in" },
];

export function IconAnimationPanel({
  selectedContent,
  onChange,
  onChangeTint,
  onOpenRecolor,
}: {
  selectedContent?: AnimationBlockContent;
  onChange?: (next: AnimationBlockContent["icon_animation"]) => void;
  onChangeTint?: (tint: string | null) => void;
  onOpenRecolor?: () => void;
}) {
  if (!selectedContent || !onChange) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
        <p className="text-sm font-medium">No icon selected</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Click an icon, image, animation or shape on the canvas to choose its entrance animation.
        </p>
      </div>
    );
  }
  const v = selectedContent.icon_animation ?? { type: "none" as const, duration: 600, delay: 0, easing: "ease-out" };
  const update = (patch: Partial<NonNullable<AnimationBlockContent["icon_animation"]>>) =>
    onChange({ type: v.type, duration: v.duration, delay: v.delay, easing: v.easing, ...patch });
  const palette = (selectedContent.palette ?? []).filter((c) => /^#?[0-9a-fA-F]{3,8}$/.test(c));
  const currentTint = selectedContent.tint ?? null;
  return (
    <div className="space-y-3 p-3">
      {palette.length > 0 && onChangeTint && (
        <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Source palette
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => onChangeTint(null)}
              title="Original colors"
              className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] transition ${
                currentTint === null ? "border-primary scale-110" : "border-border hover:border-primary/60"
              }`}
              style={{
                background:
                  "conic-gradient(from 0deg, #ef4444, #f59e0b, #84cc16, #06b6d4, #6366f1, #ec4899, #ef4444)",
              }}
            />
            {palette.map((hex, i) => {
              const h = hex.startsWith("#") ? hex : `#${hex}`;
              const sel = currentTint?.toLowerCase() === h.toLowerCase();
              return (
                <button
                  key={`${h}-${i}`}
                  onClick={() => onChangeTint(h)}
                  title={h}
                  className={`h-6 w-6 rounded-full border-2 transition ${
                    sel ? "border-primary scale-110" : "border-border hover:border-primary/60"
                  }`}
                  style={{ backgroundColor: h }}
                />
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Click a swatch to tint this asset. Click the wheel to restore original colors.
          </p>
        </div>
      )}
      <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Selected element · entrance</p>
        <Select value={v.type} onValueChange={(t) => update({ type: t as typeof v.type })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent data-keep-selection>
            {ICON_ANIM_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {v.type !== "none" && (
          <>
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
            <div>
              <Label className="text-[10px] text-muted-foreground">Easing</Label>
              <Select value={v.easing ?? "ease-out"} onValueChange={(t) => update({ easing: t })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent data-keep-selection>
                  <SelectItem value="ease-out">ease-out</SelectItem>
                  <SelectItem value="ease-in">ease-in</SelectItem>
                  <SelectItem value="ease-in-out">ease-in-out</SelectItem>
                  <SelectItem value="linear">linear</SelectItem>
                  <SelectItem value="cubic-bezier(0.34, 1.56, 0.64, 1)">spring</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}
        <p className="text-[10px] text-muted-foreground">
          The animation plays each time the element appears (when its bound word is spoken in playback &amp; export).
        </p>
      </div>
    </div>
  );
}
