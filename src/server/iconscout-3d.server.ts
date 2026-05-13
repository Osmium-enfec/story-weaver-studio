import { createClient } from "@supabase/supabase-js";

/**
 * Server-only helper: search Iconscout for 3D icons matching given keywords
 * and mirror them into animation_components so the Director can pick from
 * them. Returns the IDs of the resulting (newly mirrored or pre-existing)
 * rows so they can be included in the candidate shortlist.
 */

const BUCKET = "animation-cache";

function getAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function iconscoutSearch3D(query: string, perPage: number) {
  const id = process.env.ICONSCOUT_CLIENT_ID;
  const secret = process.env.ICONSCOUT_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Iconscout credentials not configured");
  const url = new URL("https://api.iconscout.com/v3/search");
  url.searchParams.set("query", query);
  url.searchParams.set("product_type", "item");
  url.searchParams.set("asset", "3d");
  url.searchParams.set("per_page", String(perPage));
  const res = await fetch(url.toString(), {
    headers: { "Client-ID": id, "Client-Secret": secret },
  });
  if (!res.ok) throw new Error(`Iconscout ${res.status}`);
  const json = await res.json();
  return (json?.response?.items?.data ?? []) as any[];
}

function pickStaticPreview(item: any): string | null {
  return item?.urls?.png_64 ?? item?.urls?.png ?? item?.urls?.thumb ?? null;
}

async function downloadToBucket(
  admin: ReturnType<typeof getAdmin>,
  sourceUrl: string,
  path: string,
  contentType: string,
): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Download ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Detect if the prompt / instruction / storyboard implies the user wants 3D icons.
 */
export function wants3D(...inputs: (string | undefined | null)[]): boolean {
  const text = inputs.filter(Boolean).join(" ").toLowerCase();
  return /\b(3d|3-d|three[-\s]?d|isometric|render(ed)? icon|3d icon)\b/.test(text);
}

/**
 * For each keyword, search Iconscout 3D and mirror up to `perKeyword` items
 * into animation_components. Returns the IDs of all matched rows (existing + new).
 */
export async function ensure3DForKeywords(
  keywords: string[],
  perKeyword = 3,
  totalCap = 18,
): Promise<string[]> {
  const admin = getAdmin();
  const collectedIds = new Set<string>();
  const seenExternal = new Set<string>();

  for (const kw of keywords) {
    if (collectedIds.size >= totalCap) break;
    let items: any[] = [];
    try {
      items = await iconscoutSearch3D(kw, perKeyword);
    } catch (e) {
      console.error("iconscout 3d search", kw, (e as Error).message);
      continue;
    }
    for (const it of items) {
      if (collectedIds.size >= totalCap) break;
      const externalId = `3d-${it.id}`;
      if (seenExternal.has(externalId)) continue;
      seenExternal.add(externalId);

      // Already mirrored?
      const { data: existing } = await admin
        .from("animation_components")
        .select("id")
        .eq("provider", "iconscout")
        .eq("external_id", externalId)
        .maybeSingle();
      if (existing?.id) {
        collectedIds.add(existing.id);
        continue;
      }

      const previewUrl = pickStaticPreview(it);
      if (!previewUrl) continue;

      try {
        const path = `iconscout/3d/${it.id}.png`;
        const publicUrl = await downloadToBucket(admin, previewUrl, path, "image/png");
        const tags = Array.isArray(it.tags) ? it.tags.slice(0, 8).map(String) : [];
        const { data: inserted, error } = await admin
          .from("animation_components")
          .insert({
            slug: it.slug || `iconscout-3d-${it.id}`,
            name: it.name || `3D ${it.id}`,
            category: "3D",
            provider: "iconscout",
            external_id: externalId,
            video_url: null,
            thumbnail_url: publicUrl,
            color_support: "fixed",
            tags: [...tags, "3d", kw],
            default_props: { asset_type: "3d", image_url: publicUrl },
          })
          .select("id")
          .single();
        if (error) throw error;
        if (inserted?.id) collectedIds.add(inserted.id);
      } catch (e) {
        console.error("iconscout 3d mirror", externalId, (e as Error).message);
      }
    }
  }

  return Array.from(collectedIds);
}
