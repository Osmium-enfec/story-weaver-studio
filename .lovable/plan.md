## Goal

1. Expand the **Mirror Freepik** panel so you can search and mirror every Freepik content type shown in your screenshot (All Images, Vectors, Illustrations, Photos, PSD, Templates, Mockups, Videos, Footage, Motion graphics, Video templates, Icons, 3D Models).
2. Add a **per-icon color editor** (like your second screenshot) so any already-mirrored Iconify or Freepik icon/vector SVG can be recolored and saved.

## What changes

### A. Freepik mirror panel — more asset types

`src/server/freepik.functions.ts`
- Replace the 4-type `asset_type` union with the full Freepik taxonomy:
  - `photo`, `vector`, `illustration`, `psd`, `template`, `mockup`, `icon`, `video`, `footage`, `motion-graphics`, `video-template`, `3d`
- Map each to the right Freepik query:
  - Image family → `/v1/resources` with `filters[content_type][<type>]=1`
  - Video family → `/v1/resources` with `filters[content_type][video]=1` + `filters[video_type]=<footage|motion_graphics|video_template>` where Freepik supports it
  - `icon` → `/v1/icons`
  - `3d` → `/v1/resources` with `filters[content_type][psd]=1` + `filters[3d]=1` (Freepik's 3D models live under PSD with a 3D flag)
- Extend `cacheFreepikAsset` so PSD/template/mockup/3d store under the right `default_props.asset_type` and a sensible `category`.

`src/components/FreepikMirrorPanel.tsx`
- Replace the 4-pill type row with the grouped dropdown from your screenshot:
  - **All Images** (photo+vector+illustration+psd+template+mockup) — runs parallel searches and merges results
  - Vectors, Illustrations, Photos, PSD, Templates, Mockups
  - **Videos** (footage+motion-graphics+video-template), Footage, Motion graphics, Video templates
  - Icons, 3D Models
- Keep the existing color filter, select-all, mirror-selected flow — works for every type.

### B. Icon recolor editor (Freepik + Iconify SVGs)

`src/server/icon-recolor.functions.ts` (new)
- `getIconSvg({ componentId })` — server fn. Returns the raw SVG text + parsed unique fill/stroke colors for any Iconify or Freepik-vector/icon row.
- `saveRecoloredIcon({ componentId, colorMap, saveAsNew, name? })` — applies the hex→hex map to the SVG, uploads to storage, and either overwrites the existing `animation_components` row or inserts a new "recolored copy" row (user choice).

`src/components/IconColorEditor.tsx` (new)
- Dialog modeled after your screenshot: left = current swatches list; clicking a swatch opens a color picker; "Custom palette" lets you add extra accent colors; preview on the right; "Save" / "Save as copy" buttons.
- Works for any Iconify icon and any Freepik asset whose stored file is an SVG (icons + vectors).

`src/components/LocalMediaPanel.tsx`
- On hover of an Iconify or Freepik SVG card, show a small "🎨 Recolor" button that opens `IconColorEditor` for that item.
- Raster-only items (Freepik photos/videos/PSDs/mockups, Unsplash) don't show the button.

### C. Notes / out of scope

- The inspector palette swatches we added last turn stay as-is — they apply a runtime tint at render. The new editor instead **persists** a recolored SVG so it appears recolored everywhere it's reused.
- Lottie recoloring is not included here (different format, much heavier change).

## Technical details

- SVG recolor uses simple regex replace on `fill="#..."`, `stroke="#..."`, and inline `style="fill:#..."` / `style="stroke:#..."` — covers ~all Freepik vector/icon exports and every Iconify icon.
- For Iconify SVGs that use `currentColor`, the editor exposes a single "Primary color" slot that rewrites `currentColor` → chosen hex before saving.
- New rows for "save as copy" get `provider = 'iconify-custom'` or `'freepik-custom'` so they don't collide with the originals' `(provider, external_id)` unique pair.

Want me to proceed exactly as above, or scope down (e.g. just A, or just B)?
