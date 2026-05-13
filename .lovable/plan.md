## Decision: Skip Canva integration

**Why** — neither Canva surface fits this product:

- **Apps SDK** runs *inside Canva's* editor iframe. It can push content *into* a user's Canva design, but cannot expose anything to our external app. Wrong direction.
- **Connect API** can only access the signed-in user's *own designs*. Canva's stock library (photos, elements, animations) is licensed-only-inside-Canva and has no third-party search endpoint. A "search Canva and use the result" feature is not buildable.
- The only buildable Canva feature would be "Import my own Canva design as PNG/MP4", which is a niche workflow for users who already designed something in Canva — low value compared to expanding our search providers.

**No code changes required.** Current providers stay: Iconscout (Lottie + 3D + icons + illustrations), Iconify (200k icons), Unsplash (photos), internal library, uploads.

## What's already covered

| Need | Provider |
|---|---|
| Animations (Lottie / MP4) | Iconscout (which owns LottieFiles — same content) |
| 3D illustrations | Iconscout 3D |
| Flat icons | Iconify (free, 200k+) |
| Stock photos | Unsplash |
| Custom AI images | Lovable AI Gateway (already wired in agent panel) |
| User uploads | Supabase storage |

LottieFiles is the same library as Iconscout's Lottie tier, so a separate LottieFiles integration would duplicate results. Skip.

## Optional next provider: Pexels

The one real gap is **stock video clips** (b-roll, looping backgrounds). Unsplash is photos-only. If we want that, **Pexels** is the cleanest fit:

- Free API, single key (`PEXELS_API_KEY`)
- Returns both **photos and videos** in one search
- Same mirror-on-select pattern we already use for Iconify/Unsplash
- ~30 min of work: one `src/server/pexels.functions.ts` + 30 lines in `src/lib/animation-providers.ts` + 1 branch in `AnimationSearchPanel.tsx`

## Proposed next step

Confirm one of:

1. **Add Pexels** (recommended — fills the stock-video gap)
2. **Done for now** — current 5 providers are enough; revisit if a real gap appears
3. **Something else entirely** — e.g. focus on tightening the AI director's use of existing providers instead of adding more

No files will change until you pick.
