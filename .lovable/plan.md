## Goal

Insert a **Storyboard step** between "open a canvas" and "animate it". The agent first plans the canvas as an infographic (numbered beats + small SVG flow with arrows), shows it in the chat, lets the user iterate in plain English, and only animates after the user approves — at which point timing is synced to `word_timings` (voice).

```text
script  ─▶  Storyboard agent  ─▶  beats[] + svg  ─▶  chat preview
                                                          │
                                          user edits ◀────┤
                                                          ▼
                                            "approve" / button click
                                                          │
                                                          ▼
                                  Director.compile(beats → scene_elements)
                                  start_ms derived from word_timings
```

## What changes

### 1. Data — new column on `scenes`
- `scenes.storyboard jsonb default '{}'::jsonb` — last approved/working storyboard for the canvas.
  Shape:
  ```json
  {
    "status": "draft" | "approved",
    "beats": [
      {
        "id": "b1",
        "label": "Title: useState hook",
        "kind": "title" | "icon" | "code" | "diagram" | "callout" | "image",
        "asset_query": "react hook icon",
        "anchor_word_index": 0,
        "narration_excerpt": "Today we'll learn useState…",
        "next": "b2"
      }
    ],
    "svg": "<svg …>…</svg>",
    "updated_at": "iso"
  }
  ```

### 2. Server — `src/server/storyboard.functions.ts` (new)
Three server fns, all `requireSupabaseAuth`-free (matches existing director.functions style), using `OPENAI_API_KEY` already set:

- `planStoryboard({ sceneId, instruction? })`
  - Pulls scene narration + word_timings + theme.
  - Calls GPT-5 with a `propose_storyboard` tool that returns `beats[]` (3–7 beats) with `kind`, `label`, `asset_query`, `anchor_word_index`, `narration_excerpt`, `next`.
  - Compiler (deterministic) renders a compact SVG: rounded boxes per beat with the label + kind icon, connected left-to-right (wraps to 2 rows after 4) with arrow markers. Pure server-side string build, no headless browser.
  - Persists `{status:"draft", beats, svg}` to `scenes.storyboard`. Returns it.

- `refineStoryboard({ sceneId, instruction })`
  - Same as `planStoryboard` but feeds the current `beats` + user instruction so the model patches them (re-order, swap, add/remove). Returns updated draft.

- `approveAndAnimate({ sceneId })`
  - Marks `storyboard.status = "approved"`.
  - Calls existing `directProject` with a new `storyboard` hint (passes the approved `beats` array as ground truth so the Director uses these elements/order instead of inventing its own).
  - Director already maps `anchor_word_index → start_ms` via `word_timings`, so voice sync is automatic.

### 3. Director — small extension in `src/server/director.functions.ts`
- Accept optional `storyboardHint?: Beat[]` in `directProject` input.
- When present, prompt forces: "Use exactly these beats in this order. Resolve `asset_query` against the candidate shortlist; keep `anchor_word_index` as-is." Layout/animation choice is still the LLM's job.
- No DB schema change beyond column above.

### 4. UI — `src/components/AnimationAgentPanel.tsx`
Add a **Storyboard mode** that becomes the default when scope = "this canvas":

- Top of panel: a 3-state pill — `Storyboard` · `Refine` · `Animated`.
- "Generate storyboard" button → calls `planStoryboard`. The reply bubble renders:
  - the SVG inline (`dangerouslySetInnerHTML`, sanitized to `<svg>` only),
  - a numbered list of beats below it,
  - two buttons: **Refine in chat** (focus textarea) and **Approve & animate** (calls `approveAndAnimate`, then `onApplied`).
- User chat messages while in Storyboard state call `refineStoryboard` instead of `directProject`. The reply re-renders the updated SVG + beats.
- Natural-language approval: if the user message matches `/^(approve|looks good|ship it|animate it|go ahead)/i`, run `approveAndAnimate` automatically.
- Scope toggle stays. "All canvases" keeps current behavior (skips storyboard, calls director directly) — explicit note in the panel.

### 5. Script route — `src/routes/projects.$projectId.script.tsx`
- The toolbar's **AI animate canvas** button is repurposed to **"Plan storyboard"** (opens the agent panel and triggers `planStoryboard` for the active canvas).
- **AI animate all** and **Quick fill** stay as-is.
- After `approveAndAnimate`, existing `refetchSceneElements(sceneId)` already refreshes the canvas — reuse it via the existing `onApplied` prop.

## Files

**New**
- `supabase/migrations/<ts>_scenes_storyboard.sql` — adds `storyboard jsonb default '{}'`.
- `src/server/storyboard.functions.ts` — `planStoryboard`, `refineStoryboard`, `approveAndAnimate`, plus internal `renderBeatsSvg(beats)`.

**Modified**
- `src/server/director.functions.ts` — accept `storyboardHint`, thread into prompt.
- `src/components/AnimationAgentPanel.tsx` — storyboard state machine, SVG render, approve flow.
- `src/routes/projects.$projectId.script.tsx` — rename "AI animate canvas" → "Plan storyboard", auto-open panel.

## Order of work

1. Migration: add `scenes.storyboard`.
2. `storyboard.functions.ts` + SVG renderer.
3. Director hint plumbing.
4. Agent panel rework (storyboard ↔ refine ↔ animated).
5. Toolbar wiring on the script route.

I'll start with the migration on your approval.
