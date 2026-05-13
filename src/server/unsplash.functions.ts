import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

/**
 * Unsplash — free stock photos. Requires UNSPLASH_ACCESS_KEY.
 * Docs: https://unsplash.com/documentation#search-photos
 */

const BUCKET = "animation-cache";

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin env not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface UnsplashItem {
  id: string;
  name: string;
  preview_url: string;   // small thumb for grid
  download_url: string;  // regular size for mirroring
  author: string;
  author_url: string;
}

export const searchUnsplash = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        query: z.string().min(1).max(100),
        limit: z.number().int().min(1).max(30).default(20),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ items: UnsplashItem[]; error: string | null }> => {
    const key = process.env.UNSPLASH_ACCESS_KEY;
    if (!key) return { items: [], error: "UNSPLASH_ACCESS_KEY not configured" };
    try {
      const url = new URL("https://api.unsplash.com/search/photos");
      url.searchParams.set("query", data.query);
      url.searchParams.set("per_page", String(data.limit));
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
      });
      if (!res.ok) return { items: [], error: `Unsplash ${res.status}` };
      const json = (await res.json()) as { results?: any[] };
      const items: UnsplashItem[] = (json.results ?? []).map((r) => ({
        id: String(r.id),
        name: r.alt_description || r.description || "Unsplash photo",
        preview_url: r.urls?.small ?? r.urls?.thumb ?? "",
        download_url: r.urls?.regular ?? r.urls?.full ?? "",
        author: r.user?.name ?? "",
        author_url: r.user?.links?.html ?? "",
      }));
      return { items, error: null };
    } catch (e) {
      return { items: [], error: (e as Error).message };
    }
  });

export const cacheUnsplashPhoto = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        photo_id: z.string().min(1).max(64),
        name: z.string().optional(),
        download_url: z.string().url(),
        author: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const admin = getAdmin();
    const externalId = `unsplash-${data.photo_id}`;
    const { data: existing } = await admin
      .from("animation_components")
      .select("id, thumbnail_url")
      .eq("provider", "unsplash")
      .eq("external_id", externalId)
      .maybeSingle();
    if (existing) return { id: existing.id, thumbnail_url: existing.thumbnail_url, cached: true };

    const res = await fetch(data.download_url);
    if (!res.ok) throw new Error(`Unsplash download failed ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const path = `unsplash/${data.photo_id}.jpg`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (upErr) throw upErr;
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    const { data: inserted, error } = await admin
      .from("animation_components")
      .insert({
        slug: externalId,
        name: data.name || "Unsplash photo",
        category: "Unsplash",
        provider: "unsplash",
        external_id: externalId,
        thumbnail_url: publicUrl,
        color_support: "fixed",
        default_props: {
          asset_type: "photo",
          image_url: publicUrl,
          author: data.author ?? null,
          source_query: data.name ?? null,
        },
      })
      .select("id, thumbnail_url")
      .single();
    if (error) throw error;
    return { id: inserted.id, thumbnail_url: inserted.thumbnail_url, cached: false };
  });
