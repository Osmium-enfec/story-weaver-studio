import { createClient } from "@supabase/supabase-js";

/**
 * Server-only helper: search Iconscout for Lottie animations matching given
 * keywords and mirror the MP4 preview into animation_components so the
 * Director can pick from them for storyboard beats with kind="animation".
 *
 * We mirror the MP4 preview (free, no paid plan required). The renderer
 * already handles iconscout MP4 rows via <video>.
 */

const BUCKET = "animation-cache";

function getAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function iconscoutSearchLottie(query: string, perPage: number) {
  const id = process.env.ICONSCOUT_CLIENT_ID;
  const secret = process.env.ICONSCOUT_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Iconscout credentials not configured");
  const url = new URL("https://api.iconscout.com/v3/search");
  url.searchParams.set("query", query);
  url.searchParams.set("product_type", "item");
  url.searchParams.set("asset", "lottie");
  url.searchParams.set("price", "free");
  url.searchParams.set("sort", "relevant");
  url.searchParams.set("per_page", String(perPage));
  const res = await fetch(url.toString(), {
    headers: { "Client-ID": id, "Client-Secret": secret },
  });
  if (!res.ok) throw new Error(`Iconscout ${res.status}`);
  const json = await res.json();
  return (json?.response?.items?.data ?? []) as any[];
}

function pickMp4Url(item: any): string | null {
  return (
    item?.urls?.mp4 ??
    item?.urls?.preview_mp4 ??
    item?.urls?.video ??
    item?.preview?.mp4 ??
    null
  );
}

function pickThumb(item: any): string | null {
  return (
    item?.urls?.thumb ??
    item?.urls?.png_256 ??
    item?.urls?.png_128 ??
    null
  );
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
 * For each keyword, search Iconscout lottie animations and mirror up to
 * `perKeyword` items as MP4 preview rows. Returns:
 *  - ids: all matched UUIDs (existing + new)
 *  - byKeyword: which row IDs came from which keyword
 */
export async function ensureLottieForKeywords(
  keywords: string[],
  perKeyword = 3,
  totalCap = 18,
): Promise<{ ids: string[]; byKeyword: Record<string, string[]> }> {
  const admin = getAdmin();
  const collectedIds = new Set<string>();
  const seenExternal = new Set<string>();
  const byKeyword: Record<string, string[]> = {};

  for (const kw of keywords) {
    if (collectedIds.size >= totalCap) break;
    byKeyword[kw] = byKeyword[kw] ?? [];
    let items: any[] = [];
    try {
      items = await iconscoutSearchLottie(kw, perKeyword);
    } catch (e) {
      console.error("iconscout lottie search", kw, (e as Error).message);
      continue;
    }
    for (const it of items) {
      if (collectedIds.size >= totalCap) break;
      const externalId = String(it.id);
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
        byKeyword[kw].push(existing.id);
        continue;
      }

      const previewUrl = pickMp4Url(it);
      if (!previewUrl) continue;

      try {
        const path = `iconscout/${externalId}.mp4`;
        const publicUrl = await downloadToBucket(admin, previewUrl, path, "video/mp4");
        const thumb = pickThumb(it) || publicUrl;
        const tags = Array.isArray(it.tags) ? it.tags.slice(0, 8).map(String) : [];
        const { data: inserted, error } = await admin
          .from("animation_components")
          .insert({
            slug: it.slug || `iconscout-${externalId}`,
            name: it.name || `Animation ${externalId}`,
            category: "Lottie",
            provider: "iconscout",
            external_id: externalId,
            video_url: publicUrl,
            thumbnail_url: thumb,
            color_support: "fixed",
            tags: [...tags, "lottie", "animation", kw],
          })
          .select("id")
          .single();
        if (error) throw error;
        if (inserted?.id) {
          collectedIds.add(inserted.id);
          byKeyword[kw].push(inserted.id);
        }
      } catch (e) {
        console.error("iconscout lottie mirror", externalId, (e as Error).message);
      }
    }
  }

  return { ids: Array.from(collectedIds), byKeyword };
}
