import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ShapeGlyph, type AnimationBlockContent, type ShapeType } from "@/components/AnimationBlock";

const SHAPES: { type: ShapeType; label: string }[] = [
  { type: "line", label: "Line" },
  { type: "dashed-line", label: "Dashed" },
  { type: "dotted-line", label: "Dotted" },
  { type: "arrow-right", label: "Arrow right" },
  { type: "arrow-left", label: "Arrow left" },
  { type: "square", label: "Square" },
  { type: "rounded-square", label: "Rounded" },
  { type: "circle", label: "Circle" },
  { type: "triangle", label: "Triangle" },
  { type: "inverted-triangle", label: "Triangle down" },
  { type: "pentagon", label: "Pentagon" },
  { type: "hexagon", label: "Hexagon" },
  { type: "octagon", label: "Octagon" },
  { type: "star-4", label: "4-point star" },
  { type: "star-5", label: "Star" },
  { type: "star-8", label: "Burst" },
  { type: "arrow-up", label: "Arrow up" },
  { type: "arrow-down", label: "Arrow down" },
];

export function ShapePanel({
  mode = "both",
  selectedShapeContent,
  selectedShapeSize,
  onInsertShape,
  onChangeSelectedShape,
  onChangeSelectedShapeSize,
}: {
  mode?: "insert" | "edit" | "both";
  selectedShapeContent?: AnimationBlockContent;
  selectedShapeSize?: { w: number; h: number };
  onInsertShape: (shape: ShapeType) => void;
  onChangeSelectedShape?: (patch: Partial<AnimationBlockContent>) => void;
  onChangeSelectedShapeSize?: (size: { w: number; h: number }) => void;
}) {
  const color = selectedShapeContent?.color || "#111827";
  const strokeWidth = selectedShapeContent?.shape_stroke_width ?? 7;
  const showInsert = mode === "insert" || mode === "both";
  const showEdit = mode === "edit" || mode === "both";

  return (
    <div className="space-y-4 p-3" data-keep-selection>
      {showInsert && (
      <div>
        <p className="mb-2 text-sm font-semibold">Basic shapes</p>
        <div className="grid grid-cols-3 gap-2">
          {SHAPES.map((shape) => (
            <button
              key={shape.type}
              type="button"
              title={shape.label}
              onClick={() => onInsertShape(shape.type)}
              className="flex aspect-square items-center justify-center rounded-lg border border-border bg-card p-2 transition hover:border-primary hover:bg-muted/40"
            >
              <ShapeGlyph type={shape.type} />
            </button>
          ))}
        </div>
      </div>
      )}

      {showEdit && (selectedShapeContent?.shape_type && onChangeSelectedShape ? (
        <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Selected shape</p>
          <div className="grid grid-cols-6 gap-1.5">
            {SHAPES.map((shape) => (
              <button
                key={shape.type}
                type="button"
                title={shape.label}
                onClick={() => onChangeSelectedShape({ shape_type: shape.type, name: shape.label })}
                className={`flex aspect-square items-center justify-center rounded-md border p-1.5 transition ${
                  selectedShapeContent.shape_type === shape.type
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:border-primary/60"
                }`}
              >
                <ShapeGlyph type={shape.type} color={color} strokeWidth={strokeWidth} />
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-[10px] text-muted-foreground">Color</Label>
            <input
              type="color"
              value={color}
              onChange={(e) => onChangeSelectedShape({ color: e.target.value, tint: e.target.value })}
              className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
            />
            <Input
              value={color}
              onChange={(e) => onChangeSelectedShape({ color: e.target.value, tint: e.target.value })}
              className="h-7 flex-1 text-xs"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground">Line thickness</Label>
              <span className="text-[10px] text-muted-foreground">{strokeWidth}px</span>
            </div>
            <Slider min={2} max={18} step={1} value={[strokeWidth]} onValueChange={([v]) => onChangeSelectedShape({ shape_stroke_width: v })} />
          </div>

          {selectedShapeSize && onChangeSelectedShapeSize && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">Width</Label>
                <Input
                  type="number"
                  min={24}
                  max={1280}
                  value={selectedShapeSize.w}
                  onChange={(e) => onChangeSelectedShapeSize({ ...selectedShapeSize, w: Number(e.target.value) || selectedShapeSize.w })}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Height</Label>
                <Input
                  type="number"
                  min={24}
                  max={720}
                  value={selectedShapeSize.h}
                  onChange={(e) => onChangeSelectedShapeSize({ ...selectedShapeSize, h: Number(e.target.value) || selectedShapeSize.h })}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-center">
          <p className="text-sm font-medium">No shape selected</p>
          <p className="mt-1 text-xs text-muted-foreground">Add or select a shape to edit its color, type, and size.</p>
        </div>
      ))}

      {showInsert && (
        <Button type="button" variant="secondary" className="w-full" onClick={() => onInsertShape("square")}>
          Add square
        </Button>
      )}
    </div>
  );
}