# Text Tab Redesign Plan

## 1. Restructure the Text panel UI

Replace the current 3-editor layout in `src/components/TextPanel.tsx` with a Canva-style layout:

**Section A — "Default text styles"** (matches your first screenshot)
- Three large click-to-insert tiles: **Add a heading**, **Add a subheading**, **Add a little bit of body text**
- Each tile previews the role's actual font/size/weight
- A small gear icon on each tile opens the existing role editor (font family, size, weight, line-height, color, custom font upload) in a popover — keeps current power-user controls without cluttering the main view

**Section B — "Font combinations"** (matches your second screenshot)
- Grid of preset cards (2 columns)
- Each card = a curated pairing (heading font + body font + optional accent color)
- Click a card → inserts a 2-text-block group on the canvas (heading + subheading/body), pre-styled, positioned together

**Section C — "Text animation"** (new)
- Shown in the right inspector when a text element is selected
- Dropdown: None / Fade in / Slide up / Slide left / Typewriter / Word-by-word reveal / Scale in / Bounce
- Inputs: duration (ms), delay (ms), easing
- Stored on the element content as `text_animation: { type, duration, delay, easing }`

## 2. Where to get prebuilt font combinations (free)

All Google Fonts (already loaded via `ensureGoogleFont`) — no API key needed, just hardcode pairings as data:

- **fontpair.co** — 100+ curated pairings, all Google Fonts, free to copy the pairing list
- **fontjoy.com** — algorithmic pairings, all Google Fonts
- **Google Fonts "Knowledge → Pairings"** (fonts.google.com/knowledge) — official curated pairings
- **Canva's free font pairings blog** — copy the names (the fonts themselves are on Google Fonts)
- **typ.io** and **femmebot/google-fonts-pairing-list** (GitHub) — open lists

We don't need to "import and save locally" — Google Fonts CDN already streams them on demand via `ensureGoogleFont`. We only need to store the **pairing metadata** (heading font name, body font name, weights, sample colors) as a static array in code. ~30–50 pairings is plenty.

If you want fully offline / self-hosted later: download the .woff2 files from `google-webfonts-helper` (gwfh.mranftl.com) and host in Supabase Storage — but Google's CDN is already cached, fast, and free, so this is optional.

## 3. Text animation playback

In `PlaybackDialog.tsx` and the preview route:
- When a text element enters its visible window, apply the chosen CSS animation via a class + inline `animationDuration/Delay/TimingFunction`
- For **word-by-word** and **typewriter**, render the text split into spans and stagger their animation-delay
- Reuse the existing `animate-fade-in`, `animate-scale-in`, `animate-slide-in-right` keyframes from styles.css; add `animate-slide-up`, `animate-typewriter` if missing

## 4. Data model changes

Extend `AnimationBlockContent` in `src/components/AnimationBlock.tsx`:
```ts
text_animation?: {
  type: "none" | "fade" | "slide-up" | "slide-left" | "scale" | "typewriter" | "word-reveal" | "bounce";
  duration?: number;  // ms
  delay?: number;     // ms
  easing?: string;    // cubic-bezier or keyword
}
```
And add a `font_pair_id?: string` so we can re-style a pair later.

No DB migration needed — element content is JSON.

## 5. Files to touch

- `src/components/TextPanel.tsx` — full rewrite of the panel UI (sections A, B, C selector)
- `src/lib/font-pairs.ts` — **new**: static array of ~40 curated pairings
- `src/components/AnimationBlock.tsx` — add `text_animation` to the type, render animation classes in `TextBlockRenderer`
- `src/routes/projects.$projectId.script.tsx` — handle inserting a font-pair (creates 2 elements at once), expose animation controls in the right inspector when a text element is selected
- `src/components/PlaybackDialog.tsx` — apply text animations during playback
- `src/styles.css` — add a couple of keyframes (slide-up, typewriter, word-reveal stagger helper)

## 6. Open questions before I build

1. For the **font combination cards**, do you want the preview to show the actual pair name (like "Sparkle", "CALL NOW" in your screenshot — stylized samples), or just clean "Heading / Body" previews with the real fonts?
2. Should clicking a font pair **replace** the current heading/subheading/paragraph defaults for the whole project, or just **insert** a styled pair onto the canvas as new elements?
3. Animation scope: per-element (each text box has its own animation) — confirm? Or also a "animate all text on this scene" preset?

Answer 1–3 and I'll implement.
