# Make auto-seeded animations actually appear, fit the theme, and not overlap

## Problems found in the current build

1. **You see "Add an animation from the right panel"** even though the DB has 5 elements per scene. The script route loads scenes once on mount, but seeding finishes seconds-to-minutes later inside the transcribe call. There is no refetch / realtime listener, so the UI stays stale.
2. **All seeded animations overlap.** Every element is inserted at `x=461, y=259, w=358, h=202` — identical center box. Even after refresh you'd only see the top one.
3. **Iconscout-only, theme-blind.** `seedSceneAnimations` hits Iconscout for every keyword and ignores the 817 already-mirrored items in `animation_components` and the project theme. You want the same logic as the right-panel search ("select a theme and generate using animations from search").
4. **Long, blocking transcribe.** Seeding does `keywords × scenes` serial Iconscout searches + downloads inside the transcribe request → risks Worker timeouts and a single failure kills the whole step.

## Plan

### 1. Move seeding out of `transcribeAndSplit` into its own server fn

- New `seedAnimationsForProject({ projectId, theme, replace })` in `voice.functions.ts`.
- `transcribeAndSplit` returns immediately after inserting scenes; the client kicks off seeding next.
- Per-scene work runs in parallel (`Promise.allSettled`), each scene capped to 3 keywords (down from 5) so totals stay reasonable.

### 2. Use the local library first, then Iconscout fallback

Mirror the right-panel search ranking:
1. Query `animation_components` by `name ILIKE`, `tags`, `concepts`, `course_tags` matching the keyword.
2. Apply theme filter — bias toward components whose `category`/`tags` match the project's `theme` (Whiteboard / Dark Code / Flat Modern / Android UI / Classroom).
3. Only if zero local hits, fall back to `iconscoutSearchOne` + mirror.

### 3. Non-overlapping layout

Lay the 3 animations along a 3-column row in the safe area:

```text
+------------------------------+
|  [a1]      [a2]      [a3]    |
+------------------------------+
```

Each item ~22% wide, vertically centered, gaps 4%. For >3 items wrap to a 2nd row. Element `position` computed against the 1280×720 reference canvas.

### 4. Refresh the script editor when seeding completes

Two layers:
- Client: after `transcribeAndSplit` resolves, the Create / Voice flow `await`s `seedAnimationsForProject` and only then navigates → script page sees full data on first load.
- Script route: subscribe to `scene_elements` inserts for the project's scene IDs via Supabase realtime, push new rows into state. Cleans up the "race" forever.

### 5. "Regenerate animations" button on the script page

Top-bar action: re-runs `seedAnimationsForProject({ replace:true })` for the current project. Lets the user retry on the existing project (yours has empty canvases right now).

### 6. Keep the keyword picker, tighten it

- Cap to 3 per scene (was 3-5, but with library-first lookup hits will be denser).
- Skip a keyword if no internal AND no Iconscout match (prevents blank inserts).

## Files touched

- `src/server/voice.functions.ts` — split out `seedAnimationsForProject`; library-first lookup; layout grid; remove blocking call from `transcribeAndSplit`.
- `src/components/CreateProjectDialog.tsx` & `src/routes/projects.$projectId.voice.tsx` — call `seedAnimationsForProject` after transcribe, show progress.
- `src/routes/projects.$projectId.script.tsx` — realtime sub for `scene_elements`; "Regenerate animations" toolbar button.

## Out of scope (ask if you want them)

- Full theme-style restyling (e.g. recolor lotties to match Dark Code).
- Word-level timing hints on the seeded element (we already store `word` + `occurrence`, playback already uses them).
