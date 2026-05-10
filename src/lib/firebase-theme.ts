// Built-in "Firebase" theme preset.
// Visual identity: warm orange gradient backgrounds, white card surfaces,
// Poppins typography, and a four-color palette.

import type { SceneBackground } from "@/components/BackgroundPicker";
import { ensureGoogleFont, saveTextRoles, type TextRoles } from "@/components/TextPanel";

export interface FirebaseAsset {
  id: string;
  name: string;
  url: string;
  kind: "image" | "video" | "animation";
}

export const FIREBASE_COLORS = [
  { name: "Yellow",  hex: "#ffb404" },
  { name: "Orange",  hex: "#f67e00" },
  { name: "Red",     hex: "#e13900" },
  { name: "White",   hex: "#ffffff" },
] as const;

export const FIREBASE_BACKGROUNDS: FirebaseAsset[] = [
  { id: "fb-bg-orange",  name: "Orange gradient", url: "/themes/firebase/bg-orange.svg",  kind: "image" },
  { id: "fb-bg-end",     name: "End / closing",   url: "/themes/firebase/bg-end.svg",     kind: "image" },
  { id: "fb-bg-white",   name: "White",           url: "/themes/firebase/bg-white.svg",   kind: "image" },
  { id: "fb-bg-line",    name: "White + line",    url: "/themes/firebase/bg-line.svg",    kind: "image" },
  { id: "fb-bg-asset11", name: "Header BG",       url: "/themes/firebase/bg-asset11.svg", kind: "image" },
];

export const FIREBASE_CARDS: FirebaseAsset[] = [
  { id: "fb-card-quad", name: "4-quadrant card",  url: "/themes/firebase/card-quad.svg", kind: "image" },
  { id: "fb-card-row4", name: "4-up card row",    url: "/themes/firebase/card-row4.svg", kind: "image" },
];

export const FIREBASE_FONT_FAMILY = "Poppins";

// Sizes per the user's spec:
// MAIN HEADING – 140  |  SUB HEADING – 52  |  TEXT – 32
export const FIREBASE_TEXT_ROLES: TextRoles = {
  heading:    { family: "Poppins", size: 140, weight: 700, lineHeight: 1.05, color: "#ffffff" },
  subheading: { family: "Poppins", size: 52,  weight: 600, lineHeight: 1.2,  color: "#ffffff" },
  paragraph:  { family: "Poppins", size: 32,  weight: 400, lineHeight: 1.4,  color: "#ffffff" },
};

export function backgroundFromAsset(item: FirebaseAsset): SceneBackground {
  return { type: "image", value: item.url };
}

/** Push Firebase fonts as the project's default text roles. */
export function applyFirebaseFonts() {
  ensureGoogleFont(FIREBASE_FONT_FAMILY);
  saveTextRoles(FIREBASE_TEXT_ROLES);
}
