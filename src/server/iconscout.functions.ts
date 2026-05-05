import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  query: z.string().min(0).max(200),
  asset: z.enum(["lottie", "icon", "illustration", "3d"]).default("lottie"),
  per_page: z.number().int().min(1).max(30).default(20),
});

export interface IconscoutItem {
  id: number;
  uuid: string;
  name: string;
  slug: string;
  asset: string;
  preview_url: string;
  price: number;
}

export const searchIconscout = createServerFn({ method: "GET" })
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data }): Promise<{ items: IconscoutItem[]; error: string | null }> => {
    const id = process.env.ICONSCOUT_CLIENT_ID;
    const secret = process.env.ICONSCOUT_CLIENT_SECRET;
    if (!id || !secret) return { items: [], error: "Iconscout credentials not configured" };

    const url = new URL("https://api.iconscout.com/v3/search");
    url.searchParams.set("query", data.query || "animation");
    url.searchParams.set("product_type", "item");
    url.searchParams.set("asset", data.asset);
    url.searchParams.set("per_page", String(data.per_page));

    try {
      const res = await fetch(url.toString(), {
        headers: { "Client-ID": id, "Client-Secret": secret },
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("Iconscout error", res.status, text);
        return { items: [], error: `Iconscout ${res.status}` };
      }
      const json = await res.json();
      const raw = json?.response?.items?.data ?? [];
      const items: IconscoutItem[] = raw.map((r: any) => ({
        id: r.id,
        uuid: r.uuid,
        name: r.name,
        slug: r.slug,
        asset: r.asset,
        preview_url: r.urls?.thumb ?? "",
        price: r.price ?? 0,
      }));
      return { items, error: null };
    } catch (e) {
      console.error("Iconscout fetch failed", e);
      return { items: [], error: "Iconscout request failed" };
    }
  });
