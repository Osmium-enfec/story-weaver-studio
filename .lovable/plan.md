## Goal

Restructure the AI director into a **three-stage, chat-driven flow** where the user approves at each stage. Every animation must be linked to exactly one word in the script.

```text
Stage 1: GRID         → AI proposes layout, chat allows swap
Stage 2: INFOGRAPHIC  → AI fills the grid with assets/text, chat allows swap per slot
Stage 3: ANIMATION    → AI adds entrances + word-anchors, chat allows tweaks
```

Plus the two approved tightenings:
- **Auto-pull Iconify + Unsplash** per scene narration keyword (live mirror, like 3D path)
- **Smart fallback + theme-aware text colors** (no blank scenes, no black-on-black)

---

## Stage model

Add one column to `scenes`:

```sql
alter table scenes add column director_stage text not null
  default 'idle'
  check (director_stage in ('idle','grid','infographic','animation','done'));
```

Stage transitions are user-driven via chat. The director never auto-advances past a stage without "looks good / continue" from the user.

---

## Stage 1 — Grid proposal

New server fn `proposeGrid(sceneId)`:
1. Read narration + word_timings
2. Detect beat count via existing storyboard logic
3. LLM call returns `{ layout_id, rationale, alternatives: [layout_id, layout_id] }` from the existing `LAYOUT_IDS` catalog
4. Persist as `scenes.director_plan = { stage: 'grid', layout, alternatives, rationale }`
5. Return to chat → renders **3 layout thumbnails** (current pick + 2 alternatives) with "Use this" buttons

Chat tool: `set_grid(sceneId, layoutId)` → updates plan, re-renders thumbnails.

User says "looks good" → chat calls `confirmGrid(sceneId)` → advances stage to `infographic`.

---

## Stage 2 — Infographic generation

New server fn `proposeInfographic(sceneId)`:
1. Read confirmed `layout`
2. Build candidate pool (existing `findCandidates` + **new live Iconify/Unsplash mirror per keyword**)
3. LLM places one element per slot — text or asset, NO animation yet, NO word-anchor yet
4. Persist as `director_plan = { stage: 'infographic', layout, slots: [...] }`
5. Insert preview `scene_elements` with `start_ms=0, end_ms=duration` (visible flat composition for review)

Chat tools:
- `swap_slot(sceneId, slotIndex, query)` → re-search and replace just that slot
- `change_text(sceneId, slotIndex, text)` → edit text in slot
- `regenerate_infographic(sceneId, instruction?)` → redo whole composition

User says "looks good" → `confirmInfographic(sceneId)` → advances to `animation`.

---

## Stage 3 — Animation + word-anchoring

New server fn `proposeAnimation(sceneId)`:
1. Read confirmed slots
2. LLM call: for each slot, pick `enter` (fade/slide-up/scale/etc), `duration_ms`, and **`anchor_word_index`** (REQUIRED — no element without one)
3. Validation: reject any element where `anchor_word_index` is null/out-of-range; retry once
4. Compile into `scene_elements` with proper `start_ms` derived from `word_timings[anchor_word_index].start_ms - 80ms`
5. Store `content.word`, `content.start_word_index`, `content.end_word_index` so the script panel can highlight the bound phrase

Chat tools:
- `change_animation(sceneId, slotIndex, enterType)`
- `rebind_word(sceneId, slotIndex, wordIndex)` → re-anchor one element to a different spoken word

User says "looks good" → `confirmAnimation(sceneId)` → stage becomes `done`.

---

## Word-anchor invariant (critical)

In `compilePlan`, the existing `el.anchor_word_index` is already used. New rule: **reject any compiled row whose anchor word doesn't exist**, log it, and skip. No silent fallback to `idx * 400`. This guarantees every visual on the timeline is tied to a real spoken word.

UI side: the script editor already renders chips; extend the chip to show the bound word range (`start_word_index..end_word_index`) and let the user click → hover the corresponding slot in the canvas.

---

## Auto-pull Iconify + Unsplash

In `findCandidates`, after the local DB query, for each keyword that returned <2 playable results:
1. Call `searchIconify(keyword, 4)` and `searchUnsplash(keyword, 2)` (existing server fns)
2. Mirror top hits into `animation_components` (same pattern as `ensure3DForKeywords`)
3. Add to candidate pool with `source_query: keyword` stamp

Cap total external mirror calls per scene at 12 to keep latency bounded.

---

## Smart fallback + theme colors

When LLM call fails or returns 0 elements at any stage:
- Insert a centered heading element using the scene's first 6 narration words
- Insert the highest-tag-overlap candidate from the pool (if any) at slot 1
- Anchor heading to word 0, asset to word ⌊N/2⌋

For text color, read `projects.theme` → look up `themes.design_tokens.fg` (already a JSONB) → fall back to `#0f172a`. Same for heading weight and font-family.

---

## Chat agent changes

Add three tools to the chat agent's tool list:
- `direct_scene(sceneId, stage?)` — kicks off Stage 1 if no stage, or current stage
- `update_grid(sceneId, layoutId)` / `swap_slot(...)` / `rebind_word(...)` — stage-specific edits
- `confirm_stage(sceneId)` — advances to next stage

Update the system prompt to explain the 3-stage flow and that the agent must NEVER skip a stage.

---

## Files touched

- `src/server/director.functions.ts` — split `directProject` into 3 stage fns + keep one-shot for back-compat
- `src/server/iconify.functions.ts`, `src/server/unsplash.functions.ts` — already exist, just call from director
- `src/server/agent.functions.ts` (or wherever chat tools live) — add 3 new tools
- `src/components/SceneScriptPanel.tsx` (or equivalent) — show word range on chips
- `src/components/AgentChat.tsx` — render layout thumbnails when a grid proposal arrives
- One migration for `director_stage` column

---

## Out of scope (intentionally)

- Switching LLM provider (you didn't pick that option)
- LottieFiles / Pexels / Canva
- Rewriting the existing one-shot `directProject` — it stays as a "do everything" fallback for users who don't want the chat flow

---

## Confirm before I start

This is ~6–8 hours of focused work and changes how the agent talks to the user. Before I touch code, confirm:

1. Three-stage gating with explicit "looks good" between each — correct?
2. Stage 1 should show **3 layout thumbnails** in chat (current + 2 alternatives) — or just one with a "try another" button?
3. For the word-anchor invariant: should the LLM be allowed to bind two elements to the same word, or strictly one element per word?
