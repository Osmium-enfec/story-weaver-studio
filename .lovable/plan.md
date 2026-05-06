## Animation sequence panel + word-bound visibility

### Goal
Give each canvas an explicit, reorderable animation sequence shown in the right sidebar, and make word-linked animations only appear when their bound word is spoken during playback.

### UX

**Right sidebar — new "Sequence" tab (placed first)**
- Lists all elements of the active canvas, top-to-bottom, in playback order.
- Each row shows:
  - A leading number badge (1, 2, 3…) — the play order.
  - Thumbnail/icon + name (Lottie/video/image/text preview).
  - A small chip when bound to a word: `🔗 "word"` (and occurrence # if >1).
  - Hover row → highlights the element on the canvas.
  - Click row → selects that element (same as clicking on canvas).
  - Trash icon to remove.
- Drag handle on the left to reorder via drag-and-drop (use `@dnd-kit/core` + `@dnd-kit/sortable`, already common in stack — install if missing).
- Reordering updates each element's `z_index` (which we reuse as the order index) and persists to DB.
- Empty state: "No animations yet. Add one from the Animations tab."

**Numbering on canvas**
- Each placed element on the canvas gets a small number badge (top-left corner) matching its sequence number, visible only in editor mode (not during playback/export). Helps the user correlate the list with what's on screen.
- Word-bound elements get a 🔗 marker on the badge.

### Playback rules

In `PlaybackDialog`:
- **Without voice (TTS or no narration):** elements appear in sequence order. We reveal them at evenly distributed timestamps across the scene duration, except word-bound ones which still wait for the boundary event.
- **With uploaded voice (`voice_url` + `word_timings`):**
  - Word-bound elements: appear at the start_ms of their bound word's matching occurrence (already implemented).
  - Non-bound elements: appear in the order shown in the sequence panel, distributed across the gaps between/around bound elements — never overlap a bound reveal. Concretely: take the bound elements' reveal times as anchors, then place unbound elements evenly in the remaining timeline slots in their sequence order.
- Elements never appear before their turn — initial render of a scene shows only elements whose reveal time ≤ 0 (i.e. nothing until the first cue), unlike today where everything is visible immediately.

### Data model

Reuse the existing `scene_elements.z_index` column as the canonical order field (it already drives query order). No migration required.
- Reorder = bulk update of `z_index` for affected rows in the active scene.
- New element insert keeps the current behavior: appended at end (`z_index = elements.length`).
- Delete: remaining elements get re-numbered client-side; we persist new z_indexes.

If we later need separate stacking vs. play order, we'd add `play_order` — but for now the user's mental model treats them as one.

### Files to change

- `src/routes/projects.$projectId.script.tsx`
  - Add Sequence tab as first `TabsTrigger`/`TabsContent` in the right sidebar.
  - New component `SequencePanel` (inline or extracted) rendering the sortable list.
  - `reorderElements(sceneId, newOrderIds[])` helper: updates state + bulk-updates z_index in DB.
  - Render numbered badges on each placed element on the canvas (small absolute-positioned chip).
  - Pass sequence info into `PlaybackDialog` (already implicit via `elements` order).

- `src/components/SequencePanel.tsx` (new)
  - Sortable list using `@dnd-kit/sortable`.
  - Props: `elements`, `selectedId`, `onSelect`, `onReorder(ids)`, `onRemove(id)`.

- `src/components/PlaybackDialog.tsx`
  - Build a per-scene reveal schedule:
    1. Sort elements by sequence (their incoming order).
    2. Compute reveal_ms for each: bound → word match time; unbound → distributed in remaining slots.
    3. Render only elements whose reveal_ms ≤ currentTime.
  - Replace current "show all from frame 0" behavior with this gated rendering.

- `package.json`: add `@dnd-kit/core` and `@dnd-kit/sortable` if not already installed.

### Out of scope
- Per-element duration / hide-after timing (elements stay visible until end of scene).
- Cross-scene sequencing.
- Animating the reveal itself beyond the existing element animation (could add a fade-in next pass).

### Open question (will ask before building)
For unbound elements during voice playback, two reasonable distributions:
A) Spread evenly across the scene (ignoring bound anchors).
B) Place into the gaps between bound elements proportionally.
Default to (A) unless you prefer (B).