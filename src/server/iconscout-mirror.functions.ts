import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

/**
 * Iconscout local-mirror utilities.
 *
 * Two modes:
 *  - "mp4":      mirror MP4 preview only (1 row per item, fixed colors).
 *  - "palettes": fetch Lottie JSON, generate N recolored variants locally
 *                using preset palettes (no extra Iconscout calls), and
 *                upload each as its own animation_components row.
 */

const BUCKET = "animation-cache";

// Iconscout's default color palettes (matches the picker shown in their UI).
// Index 0 = original (no recolor).
export const ICONSCOUT_PALETTES: { id: string; name: string; colors: string[] }[] = [
  { id: "original", name: "Original", colors: [] },
  { id: "warm", name: "Warm", colors: ["#FF7A45", "#52C41A", "#1677FF", "#722ED1"] },
  { id: "pastel", name: "Pastel", colors: ["#9254DE", "#D4B106", "#EB2F96", "#13C2C2"] },
  { id: "primary", name: "Primary", colors: ["#2F54EB", "#F5222D", "#FAAD14", "#52C41A"] },
  { id: "candy", name: "Candy", colors: ["#36CFC9", "#FF7875", "#BAE637", "#FF85C0"] },
];

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin env not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function iconscoutSearch(query: string, page: number, perPage: number) {
  const id = process.env.ICONSCOUT_CLIENT_ID;
  const secret = process.env.ICONSCOUT_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Iconscout credentials not configured");
  const url = new URL("https://api.iconscout.com/v3/search");
  url.searchParams.set("query", query);
  url.searchParams.set("product_type", "item");
  url.searchParams.set("asset", "lottie");
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));
  const res = await fetch(url.toString(), {
    headers: { "Client-ID": id, "Client-Secret": secret },
  });
  if (!res.ok) throw new Error(`Iconscout ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json?.response?.items?.data ?? []) as any[];
}

async function uploadBuffer(
  admin: ReturnType<typeof getAdmin>,
  buf: Uint8Array,
  path: string,
  contentType: string,
): Promise<string> {
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function downloadToBucket(
  admin: ReturnType<typeof getAdmin>,
  sourceUrl: string,
  path: string,
  contentType: string,
): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${sourceUrl}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return uploadBuffer(admin, buf, path, contentType);
}

// ---------- Lottie color helpers ----------

function rgbToHex(r: number, g: number, b: number) {
  const to = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}
function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b];
}

function walkLottie(node: any, visit: (n: any) => void) {
  if (!node || typeof node !== "object") return;
  visit(node);
  if (Array.isArray(node)) {
    for (const c of node) walkLottie(c, visit);
  } else {
    for (const k of Object.keys(node)) walkLottie(node[k], visit);
  }
}

function collectStaticColors(lottie: any): string[] {
  const counts = new Map<string, number>();
  walkLottie(lottie, (n) => {
    // Fill (ty:"fl") and Stroke (ty:"st") with static color: n.c.a === 0, n.c.k = [r,g,b,a]
    if ((n?.ty === "fl" || n?.ty === "st") && n?.c?.a === 0 && Array.isArray(n.c.k)) {
      const k = n.c.k;
      if (k.length >= 3 && typeof k[0] === "number") {
        const hex = rgbToHex(k[0], k[1], k[2]);
        counts.set(hex, (counts.get(hex) ?? 0) + 1);
      }
    }
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
}

function recolorLottie(lottie: any, palette: string[]): any {
  if (!palette.length) return lottie;
  const originals = collectStaticColors(lottie);
  if (!originals.length) return lottie;
  const map = new Map<string, [number, number, number]>();
  originals.forEach((hex, i) => map.set(hex, hexToRgb01(palette[i % palette.length])));
  const cloned = JSON.parse(JSON.stringify(lottie));
  walkLottie(cloned, (n) => {
    if ((n?.ty === "fl" || n?.ty === "st") && n?.c?.a === 0 && Array.isArray(n.c.k)) {
      const k = n.c.k;
      if (k.length >= 3 && typeof k[0] === "number") {
        const hex = rgbToHex(k[0], k[1], k[2]);
        const target = map.get(hex);
        if (target) n.c.k = [target[0], target[1], target[2], k[3] ?? 1];
      }
    }
  });
  return cloned;
}

// Try to find a Lottie JSON URL on an Iconscout item.
function pickLottieUrl(it: any): string | null {
  const candidates = [
    it?.urls?.lottie,
    it?.urls?.json,
    it?.urls?.preview_json,
    it?.urls?.animated_preview,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.toLowerCase().includes(".json")) return c;
  }
  // Some payloads stash a JSON url inside formats array
  const fmts = it?.formats ?? it?.assets ?? [];
  if (Array.isArray(fmts)) {
    for (const f of fmts) {
      const u = f?.url || f?.download_url || f?.preview_url;
      if (typeof u === "string" && u.toLowerCase().endsWith(".json")) return u;
    }
  }
  return null;
}

function pickMp4Url(it: any): string | null {
  return it?.urls?.thumb || it?.urls?.png || it?.urls?.preview || null;
}

// ---------- Server functions ----------

/** Cache a single Iconscout item (called when a user selects it). MP4 mode. */
export const cacheIconscoutItem = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        external_id: z.string(),
        uuid: z.string(),
        name: z.string(),
        slug: z.string().optional(),
        preview_url: z.string().url(),
        category: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const admin = getAdmin();
    const { data: existing } = await admin
      .from("animation_components")
      .select("id, video_url, lottie_url")
      .eq("provider", "iconscout")
      .eq("external_id", data.external_id)
      .maybeSingle();
    if (existing) return { id: existing.id, video_url: existing.video_url, cached: true };

    const ext = data.preview_url.includes(".json") ? "json" : "mp4";
    const ct = ext === "json" ? "application/json" : "video/mp4";
    const path = `iconscout/${data.external_id}.${ext}`;
    const publicUrl = await downloadToBucket(admin, data.preview_url, path, ct);

    const { data: inserted, error } = await admin
      .from("animation_components")
      .insert({
        slug: data.slug || `iconscout-${data.external_id}`,
        name: data.name,
        category: data.category || "Iconscout",
        provider: "iconscout",
        external_id: data.external_id,
        video_url: ext === "mp4" ? publicUrl : null,
        lottie_url: ext === "json" ? publicUrl : null,
        thumbnail_url: publicUrl,
        color_support: "fixed",
      })
      .select("id, video_url, lottie_url")
      .single();
    if (error) throw error;
    return { id: inserted.id, video_url: inserted.video_url, cached: false };
  });

/** Bulk pre-seed: search Iconscout and mirror up to `limit` items in the chosen mode. */
export const bulkMirrorIconscout = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        query: z.string().min(1).max(100),
        category: z.string().default("Iconscout"),
        limit: z.number().int().min(1).max(100).default(30),
        mode: z.enum(["mp4", "palettes"]).default("mp4"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const admin = getAdmin();
    const perPage = 30;
    const pages = Math.ceil(data.limit / perPage);
    let mirrored = 0;
    let skipped = 0;
    const errors: string[] = [];

    outer: for (let p = 1; p <= pages; p++) {
      let items: any[];
      try {
        items = await iconscoutSearch(data.query, p, perPage);
      } catch (e) {
        errors.push((e as Error).message);
        break;
      }
      if (!items.length) break;

      for (const it of items) {
        if (mirrored + skipped >= data.limit) break outer;
        const externalId = String(it.id);

        try {
          if (data.mode === "mp4") {
            const { data: existingMp4 } = await admin
              .from("animation_components")
              .select("id")
              .eq("provider", "iconscout")
              .eq("external_id", externalId)
              .limit(1)
              .maybeSingle();
            if (existingMp4) {
              skipped++;
              continue;
            }

            const previewUrl = pickMp4Url(it);
            if (!previewUrl) {
              skipped++;
              continue;
            }
            const path = `iconscout/${externalId}.mp4`;
            const publicUrl = await downloadToBucket(admin, previewUrl, path, "video/mp4");
            const { error } = await admin.from("animation_components").insert({
              slug: it.slug || `iconscout-${externalId}`,
              name: it.name || `Animation ${externalId}`,
              category: data.category,
              provider: "iconscout",
              external_id: externalId,
              video_url: publicUrl,
              thumbnail_url: publicUrl,
              color_support: "fixed",
            });
            if (error) throw error;
            mirrored++;
          } else {
            // palettes mode — MP4 rows do not count; only skip variants already present.
            const variantIds = ICONSCOUT_PALETTES.map((palette) => `${externalId}__${palette.id}`);
            const { data: existingVariants } = await admin
              .from("animation_components")
              .select("external_id")
              .eq("provider", "iconscout")
              .in("external_id", variantIds);
            const existingVariantIds = new Set(
              (existingVariants ?? []).map((row) => row.external_id),
            );
            if (existingVariantIds.size === ICONSCOUT_PALETTES.length) {
              skipped++;
              continue;
            }

            // palettes mode — need Lottie JSON
            const lottieUrl = pickLottieUrl(it);
            if (!lottieUrl) {
              skipped++;
              errors.push(`${externalId}: no Lottie JSON available`);
              continue;
            }
            const res = await fetch(lottieUrl);
            if (!res.ok) throw new Error(`fetch lottie ${res.status}`);
            const lottie = await res.json();
            const thumbUrl = pickMp4Url(it) || lottieUrl;

            for (let i = 0; i < ICONSCOUT_PALETTES.length; i++) {
              const palette = ICONSCOUT_PALETTES[i];
              const variant = palette.colors.length
                ? recolorLottie(lottie, palette.colors)
                : lottie;
              const variantId = `${externalId}__${palette.id}`;
              if (existingVariantIds.has(variantId)) continue;
              const path = `iconscout/${externalId}/${palette.id}.json`;
              const buf = new TextEncoder().encode(JSON.stringify(variant));
              const publicUrl = await uploadBuffer(admin, buf, path, "application/json");
              const { error } = await admin.from("animation_components").insert({
                slug: `${it.slug || `iconscout-${externalId}`}-${palette.id}`,
                name: `${it.name || `Animation ${externalId}`} (${palette.name})`,
                category: data.category,
                provider: "iconscout",
                external_id: variantId,
                lottie_url: publicUrl,
                thumbnail_url: thumbUrl,
                color_support: "palette",
                default_props: {
                  parent_external_id: externalId,
                  palette_id: palette.id,
                  palette_colors: palette.colors,
                },
              });
              if (error) throw error;
              mirrored++;
            }
          }
        } catch (e) {
          errors.push(`${externalId}: ${(e as Error).message}`);
          skipped++;
        }
      }
    }

    return { mirrored, skipped, errors: errors.slice(0, 10) };
  });
