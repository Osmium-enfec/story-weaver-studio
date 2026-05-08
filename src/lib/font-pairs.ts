// Curated free Google Font pairings.
// Sources: fontpair.co, fontjoy.com, Google Fonts Knowledge, typ.io.
// All families are on Google Fonts so they load via ensureGoogleFont().

export interface FontPair {
  id: string;
  label: string;       // shown on the card preview ("CALL NOW", "Sparkle"…)
  vibe: string;        // small caption under the card
  heading: {
    family: string;
    weight: number;
    color: string;
    italic?: boolean;
    transform?: "uppercase" | "none";
    letterSpacing?: number;
  };
  body: {
    family: string;
    weight: number;
    color: string;
    italic?: boolean;
    transform?: "uppercase" | "none";
    letterSpacing?: number;
  };
  // Display preview swatch background (hex / css color)
  swatch?: string;
}

export const FONT_PAIRS: FontPair[] = [
  {
    id: "modern-classic",
    label: "Modern Classic",
    vibe: "Editorial",
    heading: { family: "Playfair Display", weight: 700, color: "#0f172a" },
    body: { family: "Inter", weight: 400, color: "#475569" },
  },
  {
    id: "bold-statement",
    label: "BOLD",
    vibe: "Hero / poster",
    heading: { family: "Anton", weight: 400, color: "#0f172a", transform: "uppercase", letterSpacing: 1 },
    body: { family: "Lato", weight: 400, color: "#334155" },
  },
  {
    id: "call-now",
    label: "CALL NOW",
    vibe: "Bebas + Poppins",
    heading: { family: "Bebas Neue", weight: 400, color: "#0e6e5c", transform: "uppercase", letterSpacing: 2 },
    body: { family: "Poppins", weight: 600, color: "#0e6e5c" },
    swatch: "#f1f5f4",
  },
  {
    id: "sparkle",
    label: "Sparkle",
    vibe: "Script accent",
    heading: { family: "Dancing Script", weight: 700, color: "#f59e0b", italic: false },
    body: { family: "Poppins", weight: 400, color: "#475569" },
    swatch: "#faf6ee",
  },
  {
    id: "comic-cartoon",
    label: "COMIC",
    vibe: "Playful",
    heading: { family: "Permanent Marker", weight: 400, color: "#06b6d4" },
    body: { family: "Caveat", weight: 700, color: "#ec4899" },
    swatch: "#f1fbff",
  },
  {
    id: "open-247",
    label: "Open 24/7",
    vibe: "Neon",
    heading: { family: "Bebas Neue", weight: 400, color: "#a855f7", transform: "uppercase", letterSpacing: 2 },
    body: { family: "Caveat", weight: 700, color: "#ffffff" },
    swatch: "#1a0b2e",
  },
  {
    id: "bride-groom",
    label: "Bride & Groom",
    vibe: "Wedding",
    heading: { family: "Cormorant Garamond", weight: 600, color: "#1f3d2b", italic: true },
    body: { family: "Lora", weight: 400, color: "#1f3d2b" },
    swatch: "#eef0ea",
  },
  {
    id: "memo",
    label: "Official Memo",
    vibe: "Document",
    heading: { family: "Playfair Display", weight: 700, color: "#0f172a" },
    body: { family: "IBM Plex Sans", weight: 400, color: "#475569" },
  },
  {
    id: "were-hiring",
    label: "We're Hiring!",
    vibe: "Bold marketing",
    heading: { family: "Archivo Black", weight: 400, color: "#1d4ed8", italic: true },
    body: { family: "Work Sans", weight: 500, color: "#1e293b" },
  },
  {
    id: "saas-clean",
    label: "Clean SaaS",
    vibe: "Product",
    heading: { family: "Plus Jakarta Sans", weight: 700, color: "#0f172a" },
    body: { family: "Inter", weight: 400, color: "#64748b" },
  },
  {
    id: "tech-startup",
    label: "Tech Startup",
    vibe: "Geometric",
    heading: { family: "DM Sans", weight: 700, color: "#0f172a" },
    body: { family: "DM Sans", weight: 400, color: "#475569" },
  },
  {
    id: "magazine",
    label: "Magazine",
    vibe: "Serif + sans",
    heading: { family: "Merriweather", weight: 700, color: "#0f172a" },
    body: { family: "Source Sans 3", weight: 400, color: "#475569" },
  },
  {
    id: "minimal-mono",
    label: "Mono Minimal",
    vibe: "Developer",
    heading: { family: "JetBrains Mono", weight: 700, color: "#0f172a" },
    body: { family: "Inter", weight: 400, color: "#64748b" },
  },
  {
    id: "fashion",
    label: "Fashion",
    vibe: "Luxury",
    heading: { family: "Cormorant Garamond", weight: 500, color: "#0f172a", letterSpacing: 4, transform: "uppercase" },
    body: { family: "Montserrat", weight: 300, color: "#334155", letterSpacing: 2 },
  },
  {
    id: "poster-pop",
    label: "Poster Pop",
    vibe: "High contrast",
    heading: { family: "Oswald", weight: 700, color: "#dc2626", transform: "uppercase" },
    body: { family: "Roboto", weight: 400, color: "#0f172a" },
  },
  {
    id: "soft-friendly",
    label: "Friendly",
    vibe: "Rounded",
    heading: { family: "Quicksand", weight: 700, color: "#7c3aed" },
    body: { family: "Nunito", weight: 400, color: "#334155" },
  },
];

export function getPair(id: string): FontPair | undefined {
  return FONT_PAIRS.find((p) => p.id === id);
}
