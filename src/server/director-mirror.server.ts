import { createClient } from "@supabase/supabase-js";

/**
 * Server-only helper used by the AI Director to enrich its candidate pool
 * with live Iconify (free SVG icons) and Unsplash (stock photos) results,
 * mirrored into animation_components so the LLM can reference them by UUID.
 *
 * Mirrors the shape of ensure3DForKeywords: per-keyword caps, total cap,
 * and a `byKeyword` map so the caller can keep beat → asset linkage intact.
 */

const BUCKET = "animation-cache";

function getAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ---------------- Iconify ----------------

async function searchIconifyRaw(query: string, limit: number): Promise<string[]> {
  const url = new URL("https://api.iconify.design/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const json = (await res.json()) as { icons?: string[] };
  return json.icons ?? [];
}

async function ensureIconifyIcon(
  admin: ReturnType<typeof getAdmin>,
  iconId: string,
  kw: string,
): Promise<string | null> {
  const externalId = iconId;
  const { data: existing } = await admin
    .from("animation_components")
    .select("id")
    .eq("provider", "iconify")
    .eq("external_id", externalId)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const [prefix, name] = iconId.split(":");
  if (!prefix || !name) return null;
  const sourceUrl = `https://api.iconify.design/${prefix}/${name}.svg`;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) return null;
    const svg = await res.text();
    const path = `iconify/${prefix}/${name}.svg`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(
      path,
      new TextEncoder().encode(svg),
      { contentType: "image/svg+xml", upsert: true },
    );
    if (upErr) return null;
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const { data: inserted } = await admin
      .from("animation_components")
      .insert({
        slug: `iconify-${prefix}-${name}`,
        name,
        category: "Iconify",
        provider: "iconify",
        external_id: externalId,
        thumbnail_url: publicUrl,
        color_support: "theme",
        tags: [kw, "icon"],
        default_props: { asset_type: "icon", image_url: publicUrl, source_query: kw },
      })
      .select("id")
      .single();
    return inserted?.id ?? null;
  } catch {
    return null;
  }
}

// ---------------- Unsplash ----------------

interface UnsplashHit {
  id: string;
  name: string;
  download_url: string;
}

async function searchUnsplashRaw(query: string, limit: number): Promise<UnsplashHit[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  try {
    const url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", String(limit));
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: any[] };
    return (json.results ?? []).map((r) => ({
      id: String(r.id),
      name: r.alt_description || r.description || "Unsplash photo",
      download_url: r.urls?.regular ?? r.urls?.full ?? "",
    }));
  } catch {
    return [];
  }
}

async function ensureUnsplashPhoto(
  admin: ReturnType<typeof getAdmin>,
  hit: UnsplashHit,
  kw: string,
): Promise<string | null> {
  const externalId = `unsplash-${hit.id}`;
  const { data: existing } = await admin
    .from("animation_components")
    .select("id")
    .eq("provider", "unsplash")
    .eq("external_id", externalId)
    .maybeSingle();
  if (existing?.id) return existing.id;
  if (!hit.download_url) return null;

  try {
    const res = await fetch(hit.download_url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const path = `unsplash/${hit.id}.jpg`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (upErr) return null;
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const { data: inserted } = await admin
      .from("animation_components")
      .insert({
        slug: externalId,
        name: hit.name,
        category: "Unsplash",
        provider: "unsplash",
        external_id: externalId,
        thumbnail_url: publicUrl,
        color_support: "fixed",
        tags: [kw, "photo"],
        default_props: {
          asset_type: "photo",
          image_url: publicUrl,
          source_query: kw,
        },
      })
      .select("id")
      .single();
    return inserted?.id ?? null;
  } catch {
    return null;
  }
}

// ---------------- Public entrypoint ----------------

/**
 * For each keyword, mirror up to `perKeyword` icons (Iconify) and 1 photo
 * (Unsplash). Returns IDs the caller can fetch from animation_components,
 * and a per-keyword breakdown for beat → asset matching.
 *
 * `totalCap` bounds total network calls so director latency stays sane.
 */
export async function ensureExternalForKeywords(
  keywords: string[],
  opts: { iconsPerKeyword?: number; photosPerKeyword?: number; totalCap?: number } = {},
): Promise<{ ids: string[]; byKeyword: Record<string, string[]> }> {
  const iconsPerKeyword = opts.iconsPerKeyword ?? 2;
  const photosPerKeyword = opts.photosPerKeyword ?? 1;
  const totalCap = opts.totalCap ?? 12;
  const admin = getAdmin();
  const collected = new Set<string>();
  const byKeyword: Record<string, string[]> = {};

  for (const kw of keywords) {
    if (collected.size >= totalCap) break;
    byKeyword[kw] = [];

    // Iconify (cheap — no API key, fast CDN)
    if (iconsPerKeyword > 0) {
      const ids = await searchIconifyRaw(kw, iconsPerKeyword);
      for (const iconId of ids) {
        if (collected.size >= totalCap) break;
        const rowId = await ensureIconifyIcon(admin, iconId, kw);
        if (rowId && !collected.has(rowId)) {
          collected.add(rowId);
          byKeyword[kw].push(rowId);
        }
      }
    }

    // Unsplash (one per keyword to keep API quota reasonable)
    if (photosPerKeyword > 0 && collected.size < totalCap) {
      const hits = await searchUnsplashRaw(kw, photosPerKeyword);
      for (const hit of hits) {
        if (collected.size >= totalCap) break;
        const rowId = await ensureUnsplashPhoto(admin, hit, kw);
        if (rowId && !collected.has(rowId)) {
          collected.add(rowId);
          byKeyword[kw].push(rowId);
        }
      }
    }
  }

  return { ids: Array.from(collected), byKeyword };
}
