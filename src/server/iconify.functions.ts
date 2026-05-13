import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

/**
 * Iconify — free, no API key required.
 * Search: https://api.iconify.design/search?query=...&limit=...
 * SVG:    https://api.iconify.design/{prefix}/{name}.svg
 */

const BUCKET = "animation-cache";

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin env not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface IconifyItem {
  id: string;          // "mdi:rocket"
  name: string;        // "rocket"
  prefix: string;      // "mdi"
  svg_url: string;     // direct SVG URL (CDN, hot-linkable)
  preview_url: string; // same SVG (for grid)
}

export const searchIconify = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        query: z.string().min(1).max(100),
        limit: z.number().int().min(1).max(60).default(24),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ items: IconifyItem[]; error: string | null }> => {
    try {
      const url = new URL("https://api.iconify.design/search");
      url.searchParams.set("query", data.query);
      url.searchParams.set("limit", String(data.limit));
      const res = await fetch(url.toString());
      if (!res.ok) return { items: [], error: `Iconify ${res.status}` };
      const json = (await res.json()) as { icons?: string[] };
      const items: IconifyItem[] = (json.icons ?? []).map((id) => {
        const [prefix, name] = id.split(":");
        const svg = `https://api.iconify.design/${prefix}/${name}.svg`;
        return { id, name: name ?? id, prefix: prefix ?? "", svg_url: svg, preview_url: svg };
      });
      return { items, error: null };
    } catch (e) {
      return { items: [], error: (e as Error).message };
    }
  });

/** Mirror a single Iconify SVG into our bucket + animation_components. */
export const cacheIconifyIcon = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        icon_id: z.string().regex(/^[a-z0-9-]+:[a-z0-9-]+$/i),
        name: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const admin = getAdmin();
    const externalId = data.icon_id;

    const { data: existing } = await admin
      .from("animation_components")
      .select("id, thumbnail_url")
      .eq("provider", "iconify")
      .eq("external_id", externalId)
      .maybeSingle();
    if (existing) return { id: existing.id, thumbnail_url: existing.thumbnail_url, cached: true };

    const [prefix, name] = data.icon_id.split(":");
    const sourceUrl = `https://api.iconify.design/${prefix}/${name}.svg`;
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`Iconify fetch failed ${res.status}`);
    const svg = await res.text();
    const path = `iconify/${prefix}/${name}.svg`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(
      path,
      new TextEncoder().encode(svg),
      { contentType: "image/svg+xml", upsert: true },
    );
    if (upErr) throw upErr;
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    const { data: inserted, error } = await admin
      .from("animation_components")
      .insert({
        slug: `iconify-${prefix}-${name}`,
        name: data.name || name,
        category: "Iconify",
        provider: "iconify",
        external_id: externalId,
        thumbnail_url: publicUrl,
        color_support: "theme",
        default_props: { asset_type: "icon", image_url: publicUrl, source_query: data.name || name },
      })
      .select("id, thumbnail_url")
      .single();
    if (error) throw error;
    return { id: inserted.id, thumbnail_url: inserted.thumbnail_url, cached: false };
  });
