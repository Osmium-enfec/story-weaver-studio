import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

/**
 * Per-icon SVG recolor.
 * - Works for any animation_components row whose stored file is an SVG
 *   (Iconify icons + Freepik icons/vectors).
 * - Reads the SVG, parses unique colors + currentColor, applies a hex→hex map,
 *   then either overwrites the existing row or inserts a recolored copy.
 */

const BUCKET = "animation-cache";

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin env not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizeHex(h: string): string {
  const v = h.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(v)) {
    return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`;
  }
  if (/^[0-9a-f]{6}$/.test(v)) return `#${v}`;
  if (/^[0-9a-f]{8}$/.test(v)) return `#${v.slice(0, 6)}`;
  return `#${v}`;
}

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000",
  blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500", pink: "#ffc0cb",
  purple: "#800080", gray: "#808080", grey: "#808080",
};

function extractColors(svg: string): { colors: string[]; hasCurrentColor: boolean } {
  const found = new Set<string>();
  const reHex = /#([0-9a-fA-F]{3,8})\b/g;
  for (const m of svg.matchAll(reHex)) found.add(normalizeHex(m[1]));
  // rgb(r,g,b)
  const reRgb = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi;
  for (const m of svg.matchAll(reRgb)) {
    const hex = "#" + [m[1], m[2], m[3]]
      .map((n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, "0"))
      .join("");
    found.add(hex);
  }
  // named colors only inside fill="..." / stroke="..." / style attributes
  const reAttr = /(?:fill|stroke)\s*=\s*"([a-zA-Z]+)"/g;
  for (const m of svg.matchAll(reAttr)) {
    const lc = m[1].toLowerCase();
    if (NAMED[lc]) found.add(NAMED[lc]);
  }
  const hasCurrentColor = /currentColor/i.test(svg);
  return { colors: Array.from(found), hasCurrentColor };
}

function recolorSvg(svg: string, map: Record<string, string>, currentColor: string | null): string {
  let out = svg;
  const norm: Record<string, string> = {};
  for (const k of Object.keys(map)) norm[normalizeHex(k)] = normalizeHex(map[k]);

  // Replace hex
  out = out.replace(/#([0-9a-fA-F]{3,8})\b/g, (full, body) => {
    const key = normalizeHex(body);
    return norm[key] ?? full;
  });
  // Replace rgb()
  out = out.replace(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi, (full, r, g, b) => {
    const hex = "#" + [r, g, b]
      .map((n: string) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, "0"))
      .join("");
    return norm[hex] ?? full;
  });
  // Replace named colors in fill/stroke attrs
  out = out.replace(/(fill|stroke)\s*=\s*"([a-zA-Z]+)"/g, (full, attr, name) => {
    const lc = name.toLowerCase();
    const hex = NAMED[lc];
    if (hex && norm[hex]) return `${attr}="${norm[hex]}"`;
    return full;
  });
  // currentColor → explicit hex
  if (currentColor) {
    out = out.replace(/currentColor/gi, currentColor);
  }
  return out;
}

async function fetchSvg(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch SVG failed (${res.status})`);
  const text = await res.text();
  if (!/<svg[\s>]/i.test(text)) throw new Error("File is not an SVG");
  return text;
}

export const getIconSvg = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ component_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const admin = getAdmin();
    const { data: row, error } = await admin
      .from("animation_components")
      .select("id, name, provider, thumbnail_url, default_props")
      .eq("id", data.component_id)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("Component not found");

    const props = (row.default_props ?? {}) as Record<string, any>;
    const url: string | null = props.image_url ?? row.thumbnail_url ?? null;
    if (!url) throw new Error("No SVG URL on this component");
    if (!/\.svg(\?|$)/i.test(url) && props.content_type !== "image/svg+xml" && row.provider !== "iconify") {
      throw new Error("Only SVG icons/vectors are recolorable");
    }

    const svg = await fetchSvg(url);
    const { colors, hasCurrentColor } = extractColors(svg);
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      svg,
      colors,
      has_current_color: hasCurrentColor,
    };
  });

const SaveSchema = z.object({
  component_id: z.string().uuid(),
  /** map of original hex → new hex, all lowercased with leading # */
  color_map: z.record(z.string(), z.string()),
  /** value to substitute for currentColor (only used if SVG contained it) */
  current_color: z.string().nullable().optional(),
  save_as_copy: z.boolean().default(true),
  name: z.string().max(200).optional(),
});

export const saveRecoloredIcon = createServerFn({ method: "POST" })
  .inputValidator((d) => SaveSchema.parse(d))
  .handler(async ({ data }) => {
    const admin = getAdmin();
    const { data: row, error } = await admin
      .from("animation_components")
      .select("id, name, provider, category, thumbnail_url, default_props, tags, external_id")
      .eq("id", data.component_id)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("Component not found");

    const props = (row.default_props ?? {}) as Record<string, any>;
    const sourceUrl: string | null = props.image_url ?? row.thumbnail_url ?? null;
    if (!sourceUrl) throw new Error("No source SVG URL");
    const sourceSvg = await fetchSvg(sourceUrl);
    const recolored = recolorSvg(sourceSvg, data.color_map, data.current_color ?? null);

    const stamp = Date.now();
    const path = `recolor/${row.provider}/${row.id}-${stamp}.svg`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(
      path,
      new TextEncoder().encode(recolored),
      { contentType: "image/svg+xml", upsert: true },
    );
    if (upErr) throw upErr;
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    const palette = Array.from(new Set(Object.values(data.color_map).map(normalizeHex)));
    const newProps = {
      ...props,
      image_url: publicUrl,
      storage_path: path,
      content_type: "image/svg+xml",
      palette,
      recolored_from: row.id,
    };

    if (!data.save_as_copy) {
      const { error: upErr2 } = await admin
        .from("animation_components")
        .update({
          thumbnail_url: publicUrl,
          default_props: newProps,
        })
        .eq("id", row.id);
      if (upErr2) throw upErr2;
      return { id: row.id, thumbnail_url: publicUrl, created: false };
    }

    // Insert recolored copy under a *-custom provider so the unique
    // (provider, external_id) constraint never collides.
    const newProvider = `${row.provider}-custom`;
    const newExternalId = `${row.external_id ?? row.id}-recolor-${stamp}`;
    const baseName = data.name ?? `${row.name} (recolor)`;
    const newSlug = `${row.provider}-recolor-${row.id}-${stamp}`;

    const { data: inserted, error: insErr } = await admin
      .from("animation_components")
      .insert({
        slug: newSlug,
        name: baseName,
        category: row.category,
        provider: newProvider,
        external_id: newExternalId,
        thumbnail_url: publicUrl,
        color_support: "theme",
        tags: row.tags ?? [],
        default_props: newProps,
      })
      .select("id, thumbnail_url")
      .single();
    if (insErr) throw insErr;
    return { id: inserted.id, thumbnail_url: inserted.thumbnail_url, created: true };
  });
