## Goal

Replace the current rule-based `seedScene` (keyword grid + grab-bag of icons) with an AI Director agent that produces production-quality scene compositions — asset choice, layout, entrance/exit animations, timing synced to `word_timings`, and cross-scene camera/transitions — guided by reference videos you provide.

## Architecture

```text
                ┌────────────────────────────────────┐
   YouTube      │  1. Reference Profile Builder      │
   refs ───────▶│  (one-time per project, GPT-5 vision│──▶ style_profile JSON
                │   over sampled frames + transcript)│
                └────────────────────────────────────┘
                                  │
                                  ▼
   Scene  ┌─────────────────────────────────────────┐
   data ─▶│ 2. Director (per-scene LLM call)        │──▶ scene_plan JSON
          │  inputs: narration, word_timings,       │
          │  duration, theme, style_profile,        │
          │  candidate assets shortlist             │
          └─────────────────────────────────────────┘
                                  │
                                  ▼
          ┌─────────────────────────────────────────┐
          │ 3. Compiler (deterministic TS)          │
          │  scene_plan → scene_elements rows       │
          │  + content.text_animation timings       │
          │  + scene.transition / camera moves      │
          └─────────────────────────────────────────┘
                                  │
                                  ▼
                         scene_elements table
```

Three stages so the LLM only does what it's good at (creative decisions) and deterministic code does what it must (exact pixel positions, valid DB rows, asset URLs).

## Stage 1 — Reference Profile Builder

**New table** `project_style_profiles` (1 row per project):
- `reference_urls text[]` — YouTube/Vimeo links you paste
- `profile jsonb` — extracted style: pacing (avg ms/scene), motion vocabulary (pop-in, slide, draw-on, parallax), composition rules (focal point, asymmetric vs grid, max simultaneous elements), color/contrast bias, transition palette, "feel" tags
- `summary text` — short prose for prompt injection

**New server function** `buildStyleProfile({ projectId, urls })`:
1. Use YouTube Data API (or `yt-dlp` via a lightweight HTTP service — TBD: we may need to call an external service since the Worker can't run yt-dlp; alternative is to fetch oEmbed thumbnails + sample 6 frames via a free frame-grab API).
2. Send sampled frames + auto-captions to **GPT-5** with vision, ask it to return strict JSON (tool-call schema) describing the style.
3. Persist to `project_style_profiles`.

**UI**: a "Reference videos" card on the script page — paste links, click "Analyze style", shows extracted summary so you can confirm/edit.

## Stage 2 — Director (per-scene)

**Server function** `directScene({ sceneId, mode })` where mode ∈ `{full, animations_only, layout_only}`.

For each scene, build a tight prompt:
- Theme + style_profile.summary
- Narration + word_timings (truncated)
- Scene duration, aspect ratio
- **Candidate asset shortlist** (top 30) — pre-fetched by running existing `findInLibrary` for each noun/verb, plus a few Iconscout previews. Each candidate carries `{id, name, provider, preview_url, color_support, tags}`. The LLM picks from this list rather than hallucinating asset names.

Force structured output via OpenAI tool-calling. Schema:
```json
{
  "layout": "grid3x3" | "focal_left" | "focal_center" | "split" | "stack" | "free",
  "elements": [
    {
      "asset_id": "uuid-from-shortlist",
      "role": "primary" | "support" | "label",
      "position": { "x": 0..1, "y": 0..1, "w": 0..1, "h": 0..1 },
      "anchor_word_index": 12,
      "enter": { "type": "fade|slide-up|slide-left|scale|draw|pop", "duration_ms": 400, "easing": "ease-out" },
      "exit":  { "type": "...", "duration_ms": 300 },
      "emphasis": [{ "at_word_index": 18, "effect": "pulse|shake|bounce" }]
    }
  ],
  "text_overlays": [
    { "text": "useState", "style": "heading|caption|callout",
      "position": {...}, "enter": {...}, "anchor_word_index": 5 }
  ],
  "scene_transition_in":  "cut|fade|slide|zoom",
  "scene_transition_out": "cut|fade|slide|zoom",
  "camera": [{ "at_ms": 1200, "zoom": 1.15, "pan_x": 0.1, "pan_y": 0 }]
}
```

Use **GPT-5** (highest quality; cost is fine per your note). Run scenes in parallel batches of 3-4.

## Stage 3 — Compiler

Deterministic TS function `compilePlan(scene, plan)`:
- Resolves `asset_id` → real `animation_components` row, falls back to next candidate if missing.
- Converts normalized `position` (0..1) into the 1280×720 canvas pixels and applies collision/snap rules from `src/lib/grid.ts`.
- Converts `anchor_word_index` → `start_ms` using `word_timings`, derives `end_ms` from next anchor or scene end.
- Writes `text_animation` onto element `content` (already supported by `AnimationBlock` per `.lovable/plan.md`).
- Updates `scenes.transition` and stores `camera` keyframes in `scenes.background` extra field or new `camera jsonb` column (TBD).
- Inserts/updates `scene_elements` in one batch.

If the LLM returns garbage for a slot, fall back to the existing `seedScene` logic so we never make a scene worse.

## Trigger UX (both)

1. **Toolbar buttons** on `projects.$projectId.script.tsx` (replace existing auto-animate):
   - "AI animate canvas" — calls `directScene({ sceneId, mode: "full" })`
   - "AI animate all" — loops over scenes, shows progress toast

2. **Chat agent panel** — new right-side drawer `AnimationAgentPanel.tsx`:
   - Free-text instructions: *"make scene 3 more dramatic"*, *"swap the lock icon for a key"*, *"slow down the intro"*
   - Sends `{ sceneId, instruction, currentPlan }` to a new `agentEdit` server function that returns a patched `scene_plan`, then runs the same compiler.
   - Streams responses (SSE) so you see what the agent is doing.
   - Keeps a per-scene history of plans so you can revert.

## Schema changes (one migration)

- `project_style_profiles` table (project_id, reference_urls, profile jsonb, summary, timestamps)
- `scenes`: add `camera jsonb default '[]'`, `director_plan jsonb` (last plan, for chat history + re-compile without re-calling LLM)
- `scene_elements.content.text_animation` — already JSON, no migration needed

All `open_all_*` RLS to match existing tables.

## Files to add / change

**New**
- `src/server/director.functions.ts` — `buildStyleProfile`, `directScene`, `agentEdit`
- `src/lib/director/prompts.ts` — system prompts, schemas
- `src/lib/director/compile.ts` — deterministic compiler
- `src/lib/director/candidates.ts` — asset shortlist builder (reuses `findInLibrary`)
- `src/lib/director/youtube.ts` — frame sampling + caption fetch
- `src/components/AnimationAgentPanel.tsx` — chat drawer
- `src/components/StyleReferenceCard.tsx` — reference-videos input

**Modified**
- `src/routes/projects.$projectId.script.tsx` — replace existing auto-animate buttons, mount agent panel + reference card
- `src/server/voice.functions.ts` — keep `seedScene` as fallback, deprecate as primary path
- `src/components/AnimationBlock.tsx` — render `text_animation`, emphasis pulses, camera keyframes during preview
- `src/components/PlaybackDialog.tsx` — apply per-element enter/exit + scene camera moves

## Open questions before I start coding

1. **YouTube frame extraction**: easiest path is a tiny external service (Render/Fly worker running `yt-dlp` + `ffmpeg`). Alternative: skip frame analysis, feed only the YouTube transcript + your written notes about the style. Which do you prefer for v1?
2. **Camera moves**: do you want them as actual zoom/pan during playback (requires `PlaybackDialog` rework), or skip for v1 and ship asset/layout/animation/transition first?
3. **Ship order**: I recommend (a) Director + Compiler with existing assets, (b) Chat panel, (c) Style profile from references, (d) Camera. Each phase is shippable on its own. OK?

Answer those three and I'll start with phase (a).
