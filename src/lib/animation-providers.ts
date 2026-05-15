import { supabase } from "@/integrations/supabase/client";
import { searchIconscout } from "@/server/iconscout.functions";
import { searchIconify, cacheIconifyIcon } from "@/server/iconify.functions";
import { searchUnsplash, cacheUnsplashPhoto } from "@/server/unsplash.functions";
import { searchFreepik, cacheFreepikAsset } from "@/server/freepik.functions";

export type AnimationProvider =
  | "internal"
  | "lottie"
  | "upload"
  | "iconscout"
  | "image"
  | "iconify"
  | "unsplash"
  | "freepik";

const IMAGE_EXT_RE = /\.(gif|png|jpe?g|webp|avif|svg)$/i;

export interface AnimationResult {
  id: string;             // unique key (component id or url hash)
  provider: AnimationProvider;
  name: string;
  category?: string;
  tags: string[];
  concepts: string[];
  /** Visual source */
  lottie_url?: string | null;
  thumbnail_url?: string | null;
  /** Iconscout preview (mp4) */
  video_url?: string | null;
  /** Iconscout asset metadata */
  external_id?: string | null;
  /** For internal (non-Lottie) components */
  slug?: string;
  color_support: "fixed" | "theme" | "custom";
  /** Source palette (e.g. for mirrored Freepik items). */
  palette?: string[];

interface SearchOpts {
  query: string;
  limit?: number;
}

async function searchInternal({ query, limit = 24 }: SearchOpts): Promise<AnimationResult[]> {
  let q = supabase
    .from("animation_components")
    .select("id,slug,name,category,tags,concepts,provider,lottie_url,thumbnail_url,video_url,external_id,color_support")
    .neq("provider", "lottie")
    .limit(limit);
  if (query.trim()) {
    const term = `%${query.trim()}%`;
    q = q.or(`name.ilike.${term},slug.ilike.${term},category.ilike.${term}`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    provider: (r.provider as AnimationProvider) ?? "internal",
    name: r.name,
    category: r.category,
    tags: r.tags ?? [],
    concepts: r.concepts ?? [],
    slug: r.slug,
    lottie_url: r.lottie_url,
    thumbnail_url: r.thumbnail_url,
    video_url: (r as { video_url?: string | null }).video_url ?? null,
    external_id: (r as { external_id?: string | null }).external_id ?? null,
    color_support: (r.color_support as AnimationResult["color_support"]) ?? "fixed",
  }));
}

async function searchLottie({ query, limit = 24 }: SearchOpts): Promise<AnimationResult[]> {
  let q = supabase
    .from("animation_components")
    .select("id,slug,name,category,tags,concepts,provider,lottie_url,thumbnail_url,color_support")
    .eq("provider", "lottie")
    .limit(limit);
  if (query.trim()) {
    const term = `%${query.trim()}%`;
    q = q.or(`name.ilike.${term},slug.ilike.${term},category.ilike.${term}`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    provider: "lottie" as const,
    name: r.name,
    category: r.category,
    tags: r.tags ?? [],
    concepts: r.concepts ?? [],
    slug: r.slug,
    lottie_url: r.lottie_url,
    thumbnail_url: r.thumbnail_url,
    color_support: (r.color_support as AnimationResult["color_support"]) ?? "theme",
  }));
}

async function searchUploads({ query, limit = 24 }: SearchOpts): Promise<AnimationResult[]> {
  const { data, error } = await supabase.storage.from("lottie-uploads").list("", {
    limit,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error) throw error;
  const term = query.trim().toLowerCase();
  return (data ?? [])
    .filter((f) => !term || f.name.toLowerCase().includes(term))
    .map((f) => {
      const { data: url } = supabase.storage.from("lottie-uploads").getPublicUrl(f.name);
      const isImage = IMAGE_EXT_RE.test(f.name);
      return {
        id: `upload:${f.name}`,
        provider: (isImage ? "image" : "upload") as AnimationProvider,
        name: f.name.replace(/\.(json|lottie|gif|png|jpe?g|webp|avif|svg)$/i, ""),
        tags: [],
        concepts: [],
        lottie_url: isImage ? null : url.publicUrl,
        thumbnail_url: isImage ? url.publicUrl : null,
        video_url: isImage ? url.publicUrl : null,
        color_support: "theme" as const,
      };
    });
}

async function searchIconscoutResults({ query, limit = 20 }: SearchOpts): Promise<AnimationResult[]> {
  const { items } = await searchIconscout({
    data: { query: query.trim() || "animation", asset: "lottie", per_page: Math.min(limit, 30) },
  });
  return items
    .filter((i) => !!i.preview_url)
    .map((i) => ({
      id: `iconscout:${i.uuid}`,
      provider: "iconscout" as const,
      name: i.name,
      tags: [],
      concepts: [],
      external_id: String(i.id),
      video_url: i.preview_url,
      thumbnail_url: i.preview_url,
      color_support: "fixed" as const,
    }));
}

async function searchIconifyResults({ query, limit = 24 }: SearchOpts): Promise<AnimationResult[]> {
  if (!query.trim()) return [];
  const { items } = await searchIconify({ data: { query: query.trim(), limit: Math.min(limit, 60) } });
  return items.map((i) => ({
    id: `iconify:${i.id}`,
    provider: "iconify" as const,
    name: i.name,
    category: i.prefix,
    tags: [],
    concepts: [],
    external_id: i.id,
    thumbnail_url: i.preview_url,
    color_support: "theme" as const,
  }));
}

async function searchUnsplashResults({ query, limit = 20 }: SearchOpts): Promise<AnimationResult[]> {
  if (!query.trim()) return [];
  const { items } = await searchUnsplash({ data: { query: query.trim(), limit: Math.min(limit, 30) } });
  return items.map((i) => ({
    id: `unsplash:${i.id}`,
    provider: "unsplash" as const,
    name: i.name,
    category: i.author ? `Photo by ${i.author}` : "Unsplash",
    tags: [],
    concepts: [],
    external_id: i.id,
    thumbnail_url: i.preview_url,
    video_url: i.download_url,
    color_support: "fixed" as const,
  }));
}

async function searchFreepikResults({ query, limit = 20 }: SearchOpts): Promise<AnimationResult[]> {
  if (!query.trim()) return [];
  const { items } = await searchFreepik({
    data: { query: query.trim(), asset_type: "photo", limit: Math.min(limit, 30) },
  });
  return items.map((i) => ({
    id: `freepik:${i.asset_type}:${i.id}`,
    provider: "freepik" as const,
    name: i.name,
    category: i.author ? `Freepik · ${i.author}` : "Freepik",
    tags: [],
    concepts: [],
    external_id: i.id,
    thumbnail_url: i.preview_url,
    video_url: i.asset_type === "video" ? i.preview_url : null,
    color_support: "fixed" as const,
  }));
}

export async function searchAllAnimations(opts: SearchOpts): Promise<AnimationResult[]> {
  const [internal, lottie, uploads, iconscout, iconify, unsplash, freepik] = await Promise.all([
    searchInternal(opts).catch(() => []),
    searchLottie(opts).catch(() => []),
    searchUploads(opts).catch(() => []),
    searchIconscoutResults(opts).catch(() => []),
    searchIconifyResults(opts).catch(() => []),
    searchUnsplashResults(opts).catch(() => []),
    searchFreepikResults(opts).catch(() => []),
  ]);
  return [...lottie, ...iconscout, ...iconify, ...unsplash, ...freepik, ...internal, ...uploads];
}

/**
 * Mirror an external (Iconify / Unsplash) search result into our library so
 * the AI director can pick it up and so the asset survives if the upstream
 * URL ever changes. Returns the public URL of the cached asset.
 */
export async function mirrorExternalResult(r: AnimationResult): Promise<string | null> {
  try {
    if (r.provider === "iconify" && r.external_id) {
      const out = await cacheIconifyIcon({ data: { icon_id: r.external_id, name: r.name } });
      return out.thumbnail_url ?? null;
    }
    if (r.provider === "unsplash" && r.external_id && r.video_url) {
      const out = await cacheUnsplashPhoto({
        data: {
          photo_id: r.external_id,
          name: r.name,
          download_url: r.video_url,
          author: r.category?.replace(/^Photo by /, "") ?? undefined,
        },
      });
      return out.thumbnail_url ?? null;
    }
    if (r.provider === "freepik" && r.external_id) {
      // id format: freepik:<asset_type>:<id>
      const [, assetType] = r.id.split(":");
      const at = (assetType as "photo" | "vector" | "video" | "icon") || "photo";
      const out = await cacheFreepikAsset({
        data: {
          resource_id: r.external_id,
          asset_type: at,
          name: r.name,
          preview_url: r.thumbnail_url ?? undefined,
          author: r.category?.replace(/^Freepik · /, "") ?? undefined,
          palette: [],
          category: "Freepik",
        },
      });
      return at === "video" ? out.video_url ?? null : out.thumbnail_url ?? null;
    }
  } catch (e) {
    console.error("mirrorExternalResult failed", e);
  }
  return null;
}

export async function uploadLottieFile(file: File): Promise<AnimationResult> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${Date.now()}-${safe}`;
  const isImage = IMAGE_EXT_RE.test(file.name);
  const { error } = await supabase.storage
    .from("lottie-uploads")
    .upload(path, file, { contentType: file.type || (isImage ? "image/*" : "application/json"), upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("lottie-uploads").getPublicUrl(path);
  return {
    id: `upload:${path}`,
    provider: isImage ? "image" : "upload",
    name: file.name.replace(/\.(json|lottie|gif|png|jpe?g|webp|avif|svg)$/i, ""),
    tags: [],
    concepts: [],
    lottie_url: isImage ? null : data.publicUrl,
    thumbnail_url: isImage ? data.publicUrl : null,
    video_url: isImage ? data.publicUrl : null,
    color_support: "theme",
  };
}

export function fromUrl(url: string): AnimationResult {
  return {
    id: `url:${url}`,
    provider: "lottie",
    name: url.split("/").pop()?.replace(/\.(json|lottie)$/i, "") || "Lottie URL",
    tags: [],
    concepts: [],
    lottie_url: url,
    color_support: "theme",
  };
}
