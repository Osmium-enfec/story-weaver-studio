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

async function iconscoutSearch(
  query: string,
  page: number,
  perPage: number,
  asset: "lottie" | "icon" | "illustration" | "3d" = "lottie",
) {
  const id = process.env.ICONSCOUT_CLIENT_ID;
  const secret = process.env.ICONSCOUT_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Iconscout credentials not configured");
  const url = new URL("https://api.iconscout.com/v3/search");
  url.searchParams.set("query", query);
  url.searchParams.set("product_type", "item");
  url.searchParams.set("asset", asset);
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

// Iconscout's search endpoint never returns the Lottie JSON URL — only an MP4 thumb.
// To get the JSON we must call the api-download endpoint with the item's uuid.
// This requires an active Iconscout API subscription (download quota).
async function fetchIconscoutLottie(uuid: string): Promise<any> {
  const id = process.env.ICONSCOUT_CLIENT_ID;
  const secret = process.env.ICONSCOUT_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Iconscout credentials not configured");

  const url = `https://api.iconscout.com/v3/items/${uuid}/api-download?format=lottie`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Client-ID": id, "Client-Secret": secret },
  });
  const text = await res.text();
  let payload: any = null;
  try { payload = JSON.parse(text); } catch { /* not json */ }

  if (!res.ok) {
    const msg = payload?.message || text.slice(0, 200);
    if (/subscription/i.test(msg)) {
      throw new Error(`Iconscout subscription required for downloads — palette mirroring needs a paid Iconscout API plan. (${msg})`);
    }
    throw new Error(`Iconscout download ${res.status}: ${msg}`);
  }

  // Download endpoint returns { response: { download: { url: "..." } } } or similar
  const downloadUrl =
    payload?.response?.download?.url ||
    payload?.response?.download_url ||
    payload?.download_url ||
    payload?.url;
  if (!downloadUrl) throw new Error("Iconscout download response had no URL");

  const jsonRes = await fetch(downloadUrl);
  if (!jsonRes.ok) throw new Error(`Lottie fetch ${jsonRes.status}`);
  return jsonRes.json();
}

function pickMp4Url(it: any): string | null {
  return it?.urls?.thumb || it?.urls?.png || it?.urls?.preview || null;
}

// Pick the best free public PNG/SVG-thumb URL for a non-lottie asset.
function pickStaticUrl(it: any): string | null {
  return (
    it?.urls?.png_256 ||
    it?.urls?.png_128 ||
    it?.urls?.png_64 ||
    it?.urls?.thumb ||
    it?.urls?.png ||
    it?.urls?.preview ||
    null
  );
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
    let processed = 0;
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
        if (processed >= data.limit) break outer;
        const externalId = String(it.id);
        processed++;

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

            // palettes mode — fetch Lottie JSON via Iconscout download API (needs paid plan)
            if (!it?.uuid) {
              skipped++;
              errors.push(`${externalId}: missing uuid`);
              continue;
            }
            const lottie = await fetchIconscoutLottie(it.uuid);
            const thumbUrl = pickMp4Url(it) || "";

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
