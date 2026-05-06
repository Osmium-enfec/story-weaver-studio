import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Link2, Type, Sparkles } from "lucide-react";
import type { AnimationBlockContent } from "@/components/AnimationBlock";

export interface SequenceItem {
  id: string;
  type: string;
  content: AnimationBlockContent;
}

interface Props {
  items: SequenceItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onRemove: (id: string) => void;
}

function itemLabel(it: SequenceItem) {
  if (it.type === "text") {
    return (it.content.text || it.content.role || "Text").slice(0, 40);
  }
  return it.content.name || "Animation";
}

function Row({ item, index, selected, onSelect, onRemove }: {
  item: SequenceItem;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const word = item.content.word;
  const Icon = item.type === "text" ? Type : Sparkles;
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs cursor-pointer ${
        selected ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="touch-none text-muted-foreground hover:text-foreground"
        title="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
        {index + 1}
      </span>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{itemLabel(item)}</span>
      {word && (
        <span className="flex shrink-0 items-center gap-0.5 rounded bg-accent px-1 py-0.5 text-[10px] text-accent-foreground" title={`Bound to "${word}"`}>
          <Link2 className="h-3 w-3" />
          {word}
        </span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="text-muted-foreground hover:text-destructive"
        title="Remove"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function SequencePanel({ items, selectedId, onSelect, onReorder, onRemove }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(items, oldIdx, newIdx);
    onReorder(next.map((i) => i.id));
  }

  if (items.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        No animations yet. Add one from the Animations tab.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 p-3">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Plays in order. Drag to reorder.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {items.map((it, idx) => (
            <Row
              key={it.id}
              item={it}
              index={idx}
              selected={selectedId === it.id}
              onSelect={() => onSelect(it.id)}
              onRemove={() => onRemove(it.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
