import { supabase } from "@/integrations/supabase/client";
import { searchIconscout } from "@/server/iconscout.functions";

export type AnimationProvider = "internal" | "lottie" | "upload" | "iconscout" | "image";

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
}

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
      return {
        id: `upload:${f.name}`,
        provider: "upload" as const,
        name: f.name.replace(/\.(json|lottie)$/i, ""),
        tags: [],
        concepts: [],
        lottie_url: url.publicUrl,
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

export async function searchAllAnimations(opts: SearchOpts): Promise<AnimationResult[]> {
  const [a, b, c, d] = await Promise.all([
    searchInternal(opts).catch(() => []),
    searchLottie(opts).catch(() => []),
    searchUploads(opts).catch(() => []),
    searchIconscoutResults(opts).catch(() => []),
  ]);
  return [...b, ...d, ...a, ...c];
}

export async function uploadLottieFile(file: File): Promise<AnimationResult> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${Date.now()}-${safe}`;
  const { error } = await supabase.storage
    .from("lottie-uploads")
    .upload(path, file, { contentType: file.type || "application/json", upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("lottie-uploads").getPublicUrl(path);
  return {
    id: `upload:${path}`,
    provider: "upload",
    name: file.name.replace(/\.(json|lottie)$/i, ""),
    tags: [],
    concepts: [],
    lottie_url: data.publicUrl,
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
