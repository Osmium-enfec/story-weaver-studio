import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

/**
 * Iconscout local-mirror utilities.
 *
 * Strategy: when a user picks an Iconscout asset (or via a bulk pre-seed run),
 * we download the preview file to our own `animation-cache` storage bucket and
 * insert a row into `animation_components`. Subsequent searches/playback use
 * the local copy — no further calls to Iconscout's API.
 */

const BUCKET = "animation-cache";

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

async function downloadToBucket(
  admin: ReturnType<typeof getAdmin>,
  sourceUrl: string,
  path: string,
  contentType: string,
): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${sourceUrl}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Cache a single Iconscout item (called when a user selects it). */
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

    // Skip if already mirrored
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

/** Bulk pre-seed: search Iconscout for a query and mirror up to `limit` items. */
export const bulkMirrorIconscout = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        query: z.string().min(1).max(100),
        category: z.string().default("Iconscout"),
        limit: z.number().int().min(1).max(100).default(30),
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
        const previewUrl = it?.urls?.thumb || it?.urls?.png || it?.urls?.preview;
        if (!previewUrl) {
          skipped++;
          continue;
        }
        try {
          const { data: existing } = await admin
            .from("animation_components")
            .select("id")
            .eq("provider", "iconscout")
            .eq("external_id", externalId)
            .maybeSingle();
          if (existing) {
            skipped++;
            continue;
          }
          const ext = String(previewUrl).includes(".json") ? "json" : "mp4";
          const ct = ext === "json" ? "application/json" : "video/mp4";
          const path = `iconscout/${externalId}.${ext}`;
          const publicUrl = await downloadToBucket(admin, previewUrl, path, ct);
          const { error } = await admin.from("animation_components").insert({
            slug: it.slug || `iconscout-${externalId}`,
            name: it.name || `Animation ${externalId}`,
            category: data.category,
            provider: "iconscout",
            external_id: externalId,
            video_url: ext === "mp4" ? publicUrl : null,
            lottie_url: ext === "json" ? publicUrl : null,
            thumbnail_url: publicUrl,
            color_support: "fixed",
          });
          if (error) throw error;
          mirrored++;
        } catch (e) {
          errors.push(`${externalId}: ${(e as Error).message}`);
          skipped++;
        }
      }
    }

    return { mirrored, skipped, errors: errors.slice(0, 10) };
  });
