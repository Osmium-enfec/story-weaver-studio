# Add Freepik provider (photos, vectors, icons, videos)

Quick note on naming: **Magnific** is Freepik's AI image *upscaler* (a separate paid endpoint that takes an image and returns a higher-res one). The thing that lets us *search* Freepik's library is the **Freepik Stock Content API**. This plan wires up the Stock Content API. If you actually want the Magnific upscaler too, that's a separate small add-on we can layer on after.

## What you'll get

1. **Freepik tab** in the inline `AnimationSearchPanel` (next to Iconify / Unsplash / Iconscout). Search across photos, vectors, icons, and videos. Clicking a result mirrors the asset into Lovable storage and inserts it into the scene.
2. **Freepik mirror panel** in `/assets` → "Mirror" tab (mirrors the existing `IconscoutMirrorPanel` UX) for batch-importing into `animation_components`.
3. **Color palette filter** — Freepik's API exposes a fixed palette (black, white, red, orange, yellow, green, turquoise, blue, lilac, pink, gray, brown). The UI shows color swatches; selecting one filters results server-side via the API's `filters[color]` param. Each mirrored asset stores its dominant palette colors so you can re-filter the local library too.

## How it'll work (technical)

**Secret**
- Add `FREEPIK_API_KEY` via `add_secret` (you said you have one).

**Server functions** (`src/server/freepik.functions.ts`)
- `searchFreepik({ query, asset_type, color?, page })` → calls `https://api.freepik.com/v1/resources` with header `x-freepik-api-key`. Returns normalized `{ id, name, preview_url, type, palette[] }[]`.
- `cacheFreepikAsset({ resource_id })` → calls `/v1/resources/{id}/download` to get the actual file URL, fetches it server-side, uploads to the `lottie-uploads` bucket (or a new `freepik-cache` bucket — see DB section), and inserts/updates a row in `animation_components` with provider `freepik`.

Both go through `createServerFn` (no edge functions). The API key is read from `process.env.FREEPIK_API_KEY` inside the handler.

**Provider plumbing** (`src/lib/animation-providers.ts`)
- Add `"freepik"` to the `AnimationProvider` union.
- Add `searchFreepikResults()` and include it in `searchAllAnimations`'s `Promise.all`.
- Extend `mirrorExternalResult()` to handle `provider === "freepik"`.

**UI** (`src/components/AnimationSearchPanel.tsx`)
- Add `freepik` to the `FILTERS` list with a count badge.
- Add an asset-type selector (Photos / Vectors / Icons / Videos) and a color-swatch row that only appears when the Freepik filter is active. Both feed into the search call.
- Render Freepik results using `<img>` for photos/vectors/icons and `<video>` for videos (same pattern as Unsplash / Iconscout).

**Mirror panel** (`src/components/FreepikMirrorPanel.tsx`, new)
- Mirrors `IconscoutMirrorPanel` structure: search bar, asset-type tabs, color swatches, grid of results, multi-select, "Mirror N selected" button that calls `cacheFreepikAsset` for each.
- Wire into `/assets` Mirror tab alongside the existing Iconscout panel.

**Database** (one migration)
- Extend the `animation_components.provider` check (or enum) to allow `'freepik'`.
- Add a `palette text[]` column to `animation_components` so we can persist the dominant colors returned by Freepik (also lets you filter the local library by color later).
- Storage: reuse the public `lottie-uploads` bucket for cached files (consistent with how Iconify/Unsplash mirror works today). No new bucket needed unless you'd prefer separation.

## Edge cases & limits

- Freepik's API is paid and rate-limited; the search server fn will surface their error envelope through toast messages (same as Iconscout today).
- Some Freepik assets are "Premium" and require a Premium API tier to download. We'll detect 402/403 from `/download` and show a clear error in the UI rather than silently failing.
- Videos can be large; mirroring will stream the response into Storage rather than buffering it in memory.

## Out of scope (ask if you want these)

- Magnific upscaler integration (separate endpoint, separate pricing).
- AI image generation via Freepik's Mystic / Flux endpoints.
- Per-user Freepik attribution display (we'll store author + license URL on the row, but not render it yet).

After you approve, the implementation order will be: migration → secret check → server fns → providers lib → search panel UI → mirror panel UI.