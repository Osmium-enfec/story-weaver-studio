# Dual-mode editor: Word-stitched vs Timeline

## Goal
Keep the existing word-bound editing flow exactly as it is. Add a second mode where the user places animations on the timeline (start/end at chosen times), like Canva. A tab switcher at the top of the canvas page toggles between modes.

## What we already have (no changes needed)
- `scene_elements` already has `start_ms` and `end_ms` columns in the DB.
- Word binding lives in `content.word`, `content.occurrence`, `content.start_word_index` (used by `PlaybackDialog` / `ExportSceneStage` to compute reveal time).
- Playback already supports per-element reveal timing — we only need a second source of truth for *when* an element appears.

## Concept: timing_mode
Each `scene_element.content` gets a new optional field:
- `timing_mode: "word" | "timeline"` (defaults to `"word"` — preserves current behavior for every existing element).
- `"word"` → reveal time computed from `start_word_index` / `word` (today's logic).
- `"timeline"` → reveal time = element's `start_ms`, hide at `end_ms`. Word fields are ignored.

No DB migration required — `start_ms` / `end_ms` already exist, and `timing_mode` lives in the JSONB `content`.

## UI changes (script/canvas route)

### 1. Mode tabs above the canvas
Two tabs: **"Stitch to words"** (current) and **"Timeline"** (new). Tab state is local UI only (not persisted per project for now). Switching tabs only changes the right sidebar + bottom strip; the canvas itself is identical.

### 2. Word mode (unchanged)
Right sidebar shows the existing transcript + per-word animation binding. Selected element's binding edits `content.word` etc. We set `timing_mode: "word"` when an element is created/edited from this tab.

### 3. Timeline mode (new)
Replace the bottom strip with a Canva-style timeline:
- Horizontal ruler in seconds, spanning current scene duration (`scene.duration_ms`).
- One row per element (or stacked clips), each clip = an element rendered between `start_ms` and `end_ms`.
- Drag the clip body → move (updates `start_ms` & `end_ms` together, preserving length).
- Drag left/right edge → resize (updates `start_ms` or `end_ms`).
- Click clip → selects element in canvas (reuses existing selection state).
- Playhead synced with the canvas preview's `currentMs`; click the ruler to seek.
- When in Timeline mode, creating a new element from the left panels (icons / shapes / text / media) seeds it with `timing_mode: "timeline"`, `start_ms = currentMs`, `end_ms = currentMs + default (e.g. 2000)`.

The right sidebar in Timeline mode shows numeric Start / End / Duration inputs for the selected clip instead of the word-binding UI. Everything else (color, position, content) is shared.

## Playback / export changes

In `PlaybackDialog`, `ExportSceneStage`, and `preview.tsx`, update the reveal-time function:

```ts
function elementRevealMs(scene, el) {
  if (el.content.timing_mode === "timeline") {
    return el.start_ms ?? 0; // already in DB
  }
  // existing word-based logic untouched
}
```

And add a hide check for timeline elements: render only while `currentMs >= start_ms && currentMs < end_ms`. Word elements keep current behavior (visible from reveal until scene end).

## File-level breakdown

**New files**
- `src/components/CanvasModeTabs.tsx` — the two-tab switcher above the canvas.
- `src/components/TimelineEditor.tsx` — bottom timeline with clips, drag/resize, ruler, playhead.
- `src/components/TimelineClipInspector.tsx` — Start/End/Duration inputs for the right sidebar in Timeline mode.

**Edited files**
- `src/routes/projects.$projectId.script.tsx` — mount the tabs, swap bottom strip + right-sidebar panel based on active tab, seed new elements with the right `timing_mode`.
- `src/components/AnimationBlock.tsx` — extend `AnimationBlockContent` with optional `timing_mode`.
- `src/components/PlaybackDialog.tsx` — branch reveal/hide logic on `timing_mode`.
- `src/components/ExportSceneStage.tsx` — same branch (so exports match preview).
- `src/routes/projects.$projectId.preview.tsx` — same branch + drive a `currentMs` clock so timeline elements appear/disappear correctly during playback.

## Out of scope (this pass)
- Multi-track lanes with collision handling beyond simple per-element rows.
- Snapping to other clips / waveform peaks.
- Bulk migrating existing word-bound elements to timeline mode.
- Persisting the user's last-used tab.

## Open question
Should switching an element from word → timeline auto-fill its `start_ms` from the currently-bound word's audible time (so it lands in roughly the same spot)? Default answer: yes, but only on explicit user action ("Convert to timeline clip" button in the inspector), not automatically when toggling tabs.
