import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

/**
 * Freepik Stock Content API.
 * Docs: https://docs.freepik.com/
 *
 * Auth: header `x-freepik-api-key: <FREEPIK_API_KEY>`.
 * Endpoints used:
 *  - GET /v1/resources       photos / vectors / videos
 *  - GET /v1/icons           icons
 *  - GET /v1/resources/{id}/download       paid for premium assets
 *  - GET /v1/icons/{id}/download           free
 */

const BUCKET = "animation-cache";
const BASE = "https://api.freepik.com/v1";

export const FREEPIK_COLORS = [
  "black",
  "white",
  "red",
  "orange",
  "yellow",
  "green",
  "turquoise",
  "blue",
  "lilac",
  "pink",
  "gray",
  "brown",
] as const;
export type FreepikColor = (typeof FREEPIK_COLORS)[number];

export type FreepikAssetType = "photo" | "vector" | "video" | "icon";

export interface FreepikItem {
  id: string;
  asset_type: FreepikAssetType;
  name: string;
  preview_url: string;
  /** Freemium / Premium / etc. */
  license: string;
  author: string | null;
  palette: string[];
  /** Original aspect-ratio hint for grid sizing if available */
  width: number | null;
  height: number | null;
}

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin env not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

function authHeaders() {
  const key = process.env.FREEPIK_API_KEY;
  if (!key) throw new Error("FREEPIK_API_KEY not configured");
  return {
    "x-freepik-api-key": key,
    "Accept-Language": "en-US",
  };
}

interface FreepikResourceRaw {
  id: number | string;
  title?: string;
  name?: string;
  image?: { source?: { url?: string }; type?: string };
  thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
  preview?: { url?: string };
  url?: string;
  licenses?: Array<{ type?: string }>;
  author?: { name?: string };
  meta?: { is_premium?: boolean; published_at?: string };
  related?: { colors?: Array<{ hex?: string }> };
  colors?: Array<{ hex?: string }>;
  width?: number;
  height?: number;
}

function pickPreview(r: FreepikResourceRaw): string {
  return (
    r.image?.source?.url ||
    r.thumbnails?.[0]?.url ||
    r.preview?.url ||
    r.url ||
    ""
  );
}

function pickPalette(r: FreepikResourceRaw): string[] {
  const list = r.related?.colors ?? r.colors ?? [];
  return list.map((c) => c.hex).filter((x): x is string => !!x);
}

function pickLicense(r: FreepikResourceRaw): string {
  return r.licenses?.[0]?.type ?? (r.meta?.is_premium ? "premium" : "freemium");
}

const SearchSchema = z.object({
  query: z.string().min(1).max(120),
  asset_type: z.enum(["photo", "vector", "video", "icon"]).default("photo"),
  color: z.enum(FREEPIK_COLORS).optional(),
  page: z.number().int().min(1).max(50).default(1),
  limit: z.number().int().min(1).max(50).default(20),
});

export const searchFreepik = createServerFn({ method: "GET" })
  .inputValidator((d) => SearchSchema.parse(d))
  .handler(async ({ data }): Promise<{ items: FreepikItem[]; error: string | null }> => {
    let key: string | undefined;
    try {
      key = process.env.FREEPIK_API_KEY;
    } catch {
      /* noop */
    }
    if (!key) return { items: [], error: "FREEPIK_API_KEY not configured" };

    try {
      let url: URL;
      if (data.asset_type === "icon") {
        url = new URL(`${BASE}/icons`);
        url.searchParams.set("term", data.query);
        url.searchParams.set("per_page", String(data.limit));
        url.searchParams.set("page", String(data.page));
        if (data.color) url.searchParams.set("filters[color]", data.color);
      } else {
        url = new URL(`${BASE}/resources`);
        url.searchParams.set("term", data.query);
        url.searchParams.set("limit", String(data.limit));
        url.searchParams.set("page", String(data.page));
        url.searchParams.set(`filters[content_type][${data.asset_type}]`, "1");
        if (data.color) url.searchParams.set("filters[color]", data.color);
      }

      const res = await fetch(url.toString(), { headers: authHeaders() });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return { items: [], error: `Freepik ${res.status}: ${txt.slice(0, 200)}` };
      }
      const json = (await res.json()) as { data?: FreepikResourceRaw[] };
      const items: FreepikItem[] = (json.data ?? []).map((r) => ({
        id: String(r.id),
        asset_type: data.asset_type,
        name: r.title || r.name || `Freepik ${r.id}`,
        preview_url: pickPreview(r),
        license: pickLicense(r),
        author: r.author?.name ?? null,
        palette: pickPalette(r),
        width: r.width ?? r.thumbnails?.[0]?.width ?? null,
        height: r.height ?? r.thumbnails?.[0]?.height ?? null,
      }));
      return { items: items.filter((i) => i.preview_url), error: null };
    } catch (e) {
      return { items: [], error: (e as Error).message };
    }
  });

const CacheSchema = z.object({
  resource_id: z.string().min(1).max(64),
  asset_type: z.enum(["photo", "vector", "video", "icon"]),
  name: z.string().max(200).optional(),
  preview_url: z.string().url().optional(),
  author: z.string().max(200).optional(),
  palette: z.array(z.string().regex(/^#?[0-9a-fA-F]{3,8}$/)).max(20).default([]),
  category: z.string().max(80).default("Freepik"),
});

interface FreepikDownloadResp {
  data?: { url?: string; filename?: string };
}

async function fetchDownloadUrl(
  resourceId: string,
  assetType: FreepikAssetType,
): Promise<{ url: string; filename: string }> {
  const path =
    assetType === "icon"
      ? `${BASE}/icons/${resourceId}/download?format=png&png_size=256`
      : `${BASE}/resources/${resourceId}/download`;
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      res.status === 402 || res.status === 403
        ? `Freepik download requires a higher plan (${res.status})`
        : `Freepik download failed ${res.status}: ${txt.slice(0, 160)}`,
    );
  }
  const json = (await res.json()) as FreepikDownloadResp;
  const url = json.data?.url;
  if (!url) throw new Error("Freepik download response missing url");
  return { url, filename: json.data?.filename ?? `${resourceId}` };
}

function extToContentType(filename: string, fallback: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  const ext = m?.[1] ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "gif":
      return "image/gif";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "ai":
    case "eps":
      return "application/postscript";
    case "zip":
      return "application/zip";
    default:
      return fallback;
  }
}

export const cacheFreepikAsset = createServerFn({ method: "POST" })
  .inputValidator((d) => CacheSchema.parse(d))
  .handler(async ({ data }) => {
    const admin = getAdmin();
    const externalId = `freepik-${data.asset_type}-${data.resource_id}`;
    const { data: existing } = await admin
      .from("animation_components")
      .select("id, thumbnail_url, video_url, lottie_url")
      .eq("provider", "freepik")
      .eq("external_id", externalId)
      .maybeSingle();
    if (existing) {
      return {
        id: existing.id,
        thumbnail_url: existing.thumbnail_url,
        video_url: existing.video_url,
        cached: true,
      };
    }

    const { url: downloadUrl, filename } = await fetchDownloadUrl(
      data.resource_id,
      data.asset_type,
    );

    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) throw new Error(`Freepik file download ${fileRes.status}`);
    const buf = new Uint8Array(await fileRes.arrayBuffer());
    const contentType = extToContentType(
      filename,
      fileRes.headers.get("content-type") ??
        (data.asset_type === "video" ? "video/mp4" : "image/jpeg"),
    );

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || `${data.resource_id}`;
    const path = `freepik/${data.asset_type}/${data.resource_id}-${safeName}`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, {
      contentType,
      upsert: true,
    });
    if (upErr) throw upErr;
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    const isVideo = data.asset_type === "video";
    const isVector = data.asset_type === "vector";
    const palette = data.palette.map((c) => (c.startsWith("#") ? c : `#${c}`));

    const { data: inserted, error } = await admin
      .from("animation_components")
      .insert({
        slug: externalId,
        name: data.name || `Freepik ${data.asset_type}`,
        category: data.category || "Freepik",
        provider: "freepik",
        external_id: externalId,
        thumbnail_url: isVideo ? data.preview_url ?? publicUrl : publicUrl,
        video_url: isVideo ? publicUrl : null,
        color_support: "fixed",
        default_props: {
          asset_type: data.asset_type,
          image_url: isVideo ? null : publicUrl,
          video_url: isVideo ? publicUrl : null,
          author: data.author ?? null,
          license: "freepik",
          palette,
          is_vector: isVector,
        },
      })
      .select("id, thumbnail_url, video_url")
      .single();
    if (error) throw error;
    return {
      id: inserted.id,
      thumbnail_url: inserted.thumbnail_url,
      video_url: inserted.video_url,
      cached: false,
    };
  });

const BulkSchema = z.object({
  category: z.string().min(1).max(80),
  items: z
    .array(
      z.object({
        resource_id: z.string().min(1).max(64),
        asset_type: z.enum(["photo", "vector", "video", "icon"]),
        name: z.string().max(200).optional(),
        preview_url: z.string().url().optional(),
        author: z.string().max(200).optional(),
        palette: z.array(z.string()).max(20).default([]),
      }),
    )
    .min(1)
    .max(40),
});

export const mirrorFreepikSelected = createServerFn({ method: "POST" })
  .inputValidator((d) => BulkSchema.parse(d))
  .handler(async ({ data }) => {
    let mirrored = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const it of data.items) {
      try {
        const res = await cacheFreepikAsset({
          data: {
            resource_id: it.resource_id,
            asset_type: it.asset_type,
            name: it.name,
            preview_url: it.preview_url,
            author: it.author,
            palette: (it.palette ?? []).filter((c) => /^#?[0-9a-fA-F]{3,8}$/.test(c)),
            category: data.category,
          },
        });
        if (res.cached) skipped += 1;
        else mirrored += 1;
      } catch (e) {
        errors.push(`${it.resource_id}: ${(e as Error).message}`);
      }
    }
    return { mirrored, skipped, errors };
  });
