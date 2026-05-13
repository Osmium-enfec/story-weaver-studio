## Goal

Add a proper Export flow that reuses the same canvas + audio preview the user already trusts, with selectable scope (one canvas / picked canvases / whole project) and a quality preset, optimised for **quality over speed**.

## Approach (and why)

There are three viable paths. Recommendation: **Path A now, Path B as an optional "studio-grade" upgrade later.** Path C (current `/export` route) is browser MediaRecorder of a single canvas — it loses audio sync, drops frames, and is what the user wants to replace.

### Path A — Deterministic in-browser render (recommended, ships now)

For each selected scene:

1. Mount the **existing canvas preview component** off-screen at the target resolution (e.g. 1920×1080) inside a hidden container.
2. Drive animation by a **fake clock** (a `currentTimeMs` prop the AnimationBlock already respects), stepping frame-by-frame at 30/60 fps — not by `requestAnimationFrame` wall-clock. This kills the "first preview is laggy" problem because we don't depend on real-time playback.
3. For each frame: wait for all images/lottie/iconify masks to be `decode()`-ready, then snapshot the DOM via `html-to-image` → draw onto an offscreen `<canvas>` at full resolution.
4. Pipe that canvas through `captureStream(fps)` into `MediaRecorder` with **VP9 @ high bitrate (12–20 Mbps for 1080p, 30–50 Mbps for 4K)**.
5. Mix the scene's `voice_url` (respecting trim / cuts / fades / volume) into the recorder via `MediaStreamAudioDestinationNode` so audio is sample-accurate to the frames we just rendered.
6. Concatenate scenes: render each scene to its own WebM, then stitch in the browser using `mp4-muxer`/`webm-muxer` (or just deliver per-scene files when only one scene is selected).
7. Final container: **WebM (VP9 + Opus)** by default, with an optional "Convert to MP4" step using `ffmpeg.wasm` (slower but universally playable).

Quality presets:

- **720p** — 1280×720, 30 fps, 6 Mbps
- **1080p (recommended)** — 1920×1080, 30 fps, 12 Mbps
- **1080p60** — 1920×1080, 60 fps, 18 Mbps
- **4K** — 3840×2160, 30 fps, 40 Mbps

Because rendering is decoupled from real time, a 30 s scene may take 1–3 min to export — that's the trade-off the user explicitly accepted ("take proper time").

### Path B — Server-side Remotion render (optional later)

The repo already has a `worker/` Remotion setup wired to `render_jobs`. We could port the canvas+AnimationBlock layout into a Remotion composition and render true broadcast-quality H.264/MP4 with perfect audio. Best quality possible, but requires the worker to be deployed and the AnimationBlock recreated as a Remotion component. Recommend as a follow-up — Path A unblocks the user immediately and uses the exact preview they've validated.

### Path C — Current `/export` route

Delete or hide. It captures a generic `drawScene` SVG-ish rendering, not the real canvas, and has no audio. Replaced by Path A.

## Scope selection UI

New `/projects/:id/export` page:

```text
┌─ Export ────────────────────────────────────┐
│ Scope:  ( ) Current canvas                  │
│         ( ) Selected canvases  [pick list]  │
│         (•) Whole project (all canvases)    │
│                                             │
│ Quality: [720p] [1080p ✓] [1080p60] [4K]   │
│ Format:  (•) WebM (fast)  ( ) MP4 (slower) │
│ Audio:   [✓] Include voice                  │
│                                             │
│ Estimated render time: ~2 min               │
│ [ Start export ]                            │
│                                             │
│ Progress: scene 3 / 8 • 41%  ▓▓▓▓░░░░░     │
└─────────────────────────────────────────────┘
```

Multi-select uses the existing scene list (thumbnails + checkboxes). When 1 scene is selected the file is named `<project>-<scene-title>.webm`; otherwise `<project>.webm`.

## Why it will be higher quality than today's preview

- Resolution is decoupled from the on-screen canvas size — we render at 1080p/4K regardless of the editor viewport.
- Frame stepping (not wall-clock) means **no dropped frames, no first-play stutter**.
- Assets are explicitly awaited (`img.decode()`, lottie `isLoaded`, iconify mask url fetched) before each snapshot, fixing the "first play is missing assets" bug.
- Audio is mixed into the same `MediaStream` as the video, so A/V sync is locked.
- Bitrate is configurable per preset, well above MediaRecorder defaults.

## Technical changes

- **New** `src/lib/scene-exporter.ts` — `exportScenes({ sceneIds, quality, format, includeAudio, onProgress })`. Owns the offscreen mount, frame loop, MediaRecorder wiring, audio graph, and per-scene concat.
- **New** `src/components/ExportCanvasHost.tsx` — headless wrapper that renders one scene's canvas at a forced pixel size + accepts a `currentTimeMs` prop.
- **Modify** `AnimationBlock.tsx` — accept an optional `currentTimeMs` override (already partially driven by time; thread it through so it ignores `Date.now()` when in export mode).
- **Modify** `CanvasAudioEditor`-style audio resolution into a shared helper `src/lib/audio-graph.ts` so both preview and exporter apply trims/cuts/fades identically.
- **Replace** `src/routes/projects.$projectId.export.tsx` with the new scope/quality UI; keep the existing render-jobs list hidden behind an "Advanced (server render)" disclosure for Path B later.
- **Add deps**: `mp4-muxer` (or `webm-muxer`) for in-browser concat; `@ffmpeg/ffmpeg` only if the user picks MP4 output.
- **Keep** Path B (`worker/`, `render_jobs`) untouched — no wasted work, available when we want server-side renders.

## Out of scope for this plan

- Server-side Remotion port (Path B) — separate follow-up.
- Cloud delivery / share links for exports — local download only.
- Background music tracks — only per-scene `voice_url` is mixed.

## Open questions before I build

1. **Scene picker UX**: are multi-scene exports usually "all" or genuinely a custom subset? If almost always "all", I'll keep the picker but default-collapse it.
2. **Default output**: WebM (works everywhere modern, fast) vs MP4 (universal but adds ~30 s of `ffmpeg.wasm` transcode at the end). I'd default to WebM with a one-click "Convert to MP4" toggle.
3. **Resolution ceiling**: confirm 4K is needed. It's ~6× the work of 1080p and the visual gain on icon/text-heavy content is small — happy to ship 720p / 1080p / 1080p60 only and add 4K later.  
  
go with option A  
ship upto 1080 level not 4k for now  
yes give option of both webM and mp4  
