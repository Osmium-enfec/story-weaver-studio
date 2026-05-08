// Sticker / banner-style text presets: text on a solid colored bar.
// Used by the Text panel "Banners" sub-tab.

export interface BannerPreset {
  id: string;
  label: string;          // sample text shown on the card and inserted on canvas
  font_family: string;
  font_weight: number;
  letter_spacing?: number;
  italic?: boolean;
  transform?: "uppercase" | "none";
  text_color: string;     // foreground color
  bg_color: string;       // background bar color
  border_color?: string;  // optional outline color (e.g. white outline on dark canvas)
  border_width?: number;
  radius?: number;        // corner radius (px)
  padding_x?: number;     // horizontal padding (px)
  padding_y?: number;     // vertical padding (px)
}

export const BANNER_PRESETS: BannerPreset[] = [
  {
    id: "white-on-black",
    label: "I KNOW TOO MUCH",
    font_family: "Anton", font_weight: 700, transform: "uppercase", letter_spacing: 1,
    text_color: "#0a0a0a", bg_color: "#ffffff",
    border_color: "#0a0a0a", border_width: 6,
    radius: 4, padding_x: 28, padding_y: 14,
  },
  {
    id: "black-on-yellow",
    label: "BREAKING NEWS",
    font_family: "Anton", font_weight: 700, transform: "uppercase", letter_spacing: 1,
    text_color: "#0a0a0a", bg_color: "#fde047",
    radius: 4, padding_x: 28, padding_y: 14,
  },
  {
    id: "white-on-red",
    label: "SALE TODAY",
    font_family: "Bebas Neue", font_weight: 400, transform: "uppercase", letter_spacing: 2,
    text_color: "#ffffff", bg_color: "#dc2626",
    radius: 4, padding_x: 28, padding_y: 14,
  },
  {
    id: "white-on-blue",
    label: "NEW DROP",
    font_family: "Archivo Black", font_weight: 400, transform: "uppercase",
    text_color: "#ffffff", bg_color: "#1d4ed8",
    radius: 4, padding_x: 28, padding_y: 14,
  },
  {
    id: "black-on-lime",
    label: "LIMITED OFFER",
    font_family: "Oswald", font_weight: 700, transform: "uppercase", letter_spacing: 1,
    text_color: "#0a0a0a", bg_color: "#a3e635",
    radius: 4, padding_x: 28, padding_y: 14,
  },
  {
    id: "white-on-pink",
    label: "HOT TAKE",
    font_family: "Anton", font_weight: 700, transform: "uppercase", letter_spacing: 1,
    text_color: "#ffffff", bg_color: "#ec4899",
    radius: 4, padding_x: 28, padding_y: 14,
  },
  {
    id: "cream-on-green",
    label: "FRESH PICK",
    font_family: "Bebas Neue", font_weight: 400, transform: "uppercase", letter_spacing: 2,
    text_color: "#fef3c7", bg_color: "#166534",
    radius: 4, padding_x: 28, padding_y: 14,
  },
  {
    id: "black-on-orange",
    label: "TRENDING NOW",
    font_family: "Archivo Black", font_weight: 400, transform: "uppercase",
    text_color: "#0a0a0a", bg_color: "#fb923c",
    radius: 4, padding_x: 28, padding_y: 14,
  },
  {
    id: "white-on-purple",
    label: "MUST WATCH",
    font_family: "Oswald", font_weight: 700, transform: "uppercase", letter_spacing: 1,
    text_color: "#ffffff", bg_color: "#7c3aed",
    radius: 999, padding_x: 32, padding_y: 14,
  },
  {
    id: "outline-light",
    label: "TAP IN",
    font_family: "Anton", font_weight: 700, transform: "uppercase", letter_spacing: 1,
    text_color: "#0a0a0a", bg_color: "#ffffff",
    border_color: "#0a0a0a", border_width: 4,
    radius: 999, padding_x: 32, padding_y: 14,
  },
  {
    id: "teal-pop",
    label: "GO LIVE",
    font_family: "Bebas Neue", font_weight: 400, transform: "uppercase", letter_spacing: 2,
    text_color: "#ffffff", bg_color: "#0e6e5c",
    radius: 4, padding_x: 28, padding_y: 14,
  },
  {
    id: "midnight",
    label: "CHAPTER 01",
    font_family: "Archivo Black", font_weight: 400, transform: "uppercase", letter_spacing: 1,
    text_color: "#fde047", bg_color: "#0f172a",
    radius: 4, padding_x: 28, padding_y: 14,
  },
];
