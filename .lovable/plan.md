# Premium Timeline Editor Upgrade

Goal: Replace the current basic `TimelineEditor` (used inside the Canvas page when the user toggles "Timeline" mode) with a polished, dark, multi-track timeline that looks and feels like Canva / CapCut / Premiere Rush — while keeping the editing model simple so the user can still do basic stuff (drag, resize, trim, delete, select).

Scope is **frontend only**. No DB changes — we already persist `start_ms`, `end_ms`, `z_index`, `type`, `content` on `scene_elements`. The existing "Stitch to words" mode stays untouched.

---

## What the user gets

A new bottom-anchored Timeline workspace inside the script/canvas page when "Timeline" tab is active:

```text
┌───────────────────────────────────────────────────────────────┐
│  Canvas preview (existing, unchanged)                         │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  Timeline Toolbar:  ⟲ ⟳   ▶ ⏸   00:03.20 / 00:12.00   − ▭ +  │
├──────────┬────────────────────────────────────────────────────┤
│ Layers   │ Ruler  0:00   0:02   0:04   0:06   0:08   0:10     │
│ (left)   │ ─────────────────┃──────────────────────────────── │
│  ▦ Text  │ ▰▰▰▰▰▰▰  (blue clip "Hello")                       │
│  ◆ Shape │       ▰▰▰▰▰▰▰▰▰▰▰ (purple)                         │
│  ★ Anim  │ ▰▰▰▰▰▰  (amber)  ▰▰▰▰ (amber)                      │
│  🖼 Image│             ▰▰▰▰▰▰▰▰ (pink)                        │
└──────────┴────────────────────────────────────────────────────┘
```

- One row per **element type group** (Text, Shapes, Animations/Icons, Images, Video, Audio). Each group can contain multiple clips on the same row, color-coded by type.
- Each clip = one `scene_element`. Drag to reposition, drag edges to resize. Click selects (syncs with canvas selection). Delete key removes.
- Vertical red **playhead** with a draggable triangle handle on the ruler; scrubbing updates a small preview indicator and the canvas current-time.
- Group rows have left-side controls: icon, label, count, eye (hide) and lock toggles, collapse caret.
- Toolbar above: Undo/Redo (wired to existing history if available, otherwise hidden), Play/Pause, current time / total duration, zoom −/+ slider, "Add" menu (Text, Shape, Animation, Image).
- Right-side **Properties panel** (only when a clip is selected): Start, Duration, End (numeric inputs in seconds), Z-index up/down, Opacity slider, plus a "Delete clip" button. Position/Scale/Rotation already exist in the canvas inspector — we link to that for now (no duplication).

Visual style: dark `#0f1115` background, glass panels (`bg-white/5 backdrop-blur`), 8px rounded clips with subtle gradient + soft shadow, blue ring on selected, hover glow, thin `border-white/5` grid lines, Inter/UI font, ~12px ruler text. All colors via `src/styles.css` tokens (we'll add `--timeline-*` tokens) — no raw hex in components.

---

## Files

**New components** (split so each file stays small and focused):

- `src/components/timeline/TimelineWorkspace.tsx` — orchestrator: holds zoom, playhead ms, selection, scroll. Replaces current usage of `TimelineEditor` from `projects.$projectId.script.tsx`.
- `src/components/timeline/TimelineToolbar.tsx` — play/pause, time readout, zoom controls, add-clip menu.
- `src/components/timeline/TimelineRuler.tsx` — time ticks + draggable playhead handle.
- `src/components/timeline/TimelineTrack.tsx` — one group row (label + lane). Renders clips for one element-type group.
- `src/components/timeline/TimelineClip.tsx` — single draggable/resizable clip with selection + hover states.
- `src/components/timeline/TimelinePlayhead.tsx` — the vertical red line spanning all tracks (positioned absolutely over lanes).
- `src/components/timeline/TimelineLayersPanel.tsx` — left column listing groups with hide/lock/collapse.
- `src/components/timeline/TimelineInspector.tsx` — right column properties for the selected clip.
- `src/components/timeline/timelineUtils.ts` — px↔ms conversion, snap-to-grid (250 ms), group-by-type, clamp helpers.

**Edited:**

- `src/routes/projects.$projectId.script.tsx` — swap `<TimelineEditor …/>` for `<TimelineWorkspace …/>`; pass the same props (elements, scene duration, update/delete handlers, selectedElementId).
- `src/styles.css` — add timeline tokens (`--timeline-bg`, `--timeline-panel`, `--timeline-grid`, `--timeline-clip-text`, `--timeline-clip-shape`, `--timeline-clip-anim`, `--timeline-clip-image`, `--timeline-playhead`, `--timeline-selected-ring`) in oklch.

**Removed:** `src/components/TimelineEditor.tsx` after the new workspace is wired in.

---

## Interaction details

- **Drag clip body** → updates `start_ms` (keeps duration). On mouseup, persist via existing element-update handler.
- **Drag left edge** → updates `start_ms`; clamps to `>= 0` and `< end_ms - 250 ms`.
- **Drag right edge** → updates `end_ms`; clamps to `<= scene.duration_ms` and `> start_ms + 250 ms`.
- **Snap**: 250 ms grid by default; hold `Alt` to bypass snap.
- **Zoom**: `pxPerSecond` state, 20–400 px/s, controlled by toolbar slider and `Ctrl/Cmd + wheel` over the lanes.
- **Playhead drag**: updates a local `playheadMs`; emits to parent so the canvas preview can mirror (uses the same prop the current `TimelineEditor` already wires for scrubbing if present, else read-only for now).
- **Selection**: clicking a clip sets `selectedElementId` (already in parent). Selected clip gets `ring-2 ring-[--timeline-selected-ring]` and inspector populates.
- **Keyboard**: `Delete`/`Backspace` removes selected clip (only when timeline workspace has focus). `Space` toggles play/pause.

---

## Out of scope (kept simple per user request)

- Multi-clip drag selection box, ripple edit, clip splitting, transitions between clips, audio waveform rendering, keyframe curves UI, FPS indicator, auto-save badge — we'll show static visual affordances only if mentioned (no real logic) or omit. The user explicitly said "keep it simple so I can do basic stuff", so we ship: drag, resize, select, delete, add, zoom, scrub, hide/lock per group.
- No new DB columns, no migrations.
- Word-stitched mode is untouched.

---

## Open question

The current `TimelineEditor` already takes `playheadMs` / `onScrub` style props from the parent (or it doesn't — I'll inherit whatever exists). If the canvas preview component doesn't yet accept an external `currentMs`, scrubbing the playhead will only move the red line, not the canvas. Wiring the canvas to follow the timeline playhead is a small follow-up — flag it if you want it included in this same change, otherwise it ships as a visual scrub only.  
ok so i want to edit my canvas as we do in canva like can change duration of elements can preview can change timeline of an element by increasing and decreasing the time size and placing it on timeline, it also have the audio along with it so that i must see in real time that it is working properly, on the place of current time input give me visual drag and slide option to edit

&nbsp;