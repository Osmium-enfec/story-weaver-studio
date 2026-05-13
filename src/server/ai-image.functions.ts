import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

/**
 * On-demand AI image generation. Calls the Lovable AI Gateway (Nano Banana)
 * to create a custom illustration / icon / scene image, uploads it to the
 * animation-cache bucket, and inserts an animation_components row tagged
 * "ai-generated" so the Director can pick it like any other asset.
 *
 * Use cases:
 *  - User says "generate an image of X" in the agent chat.
 *  - A storyboard beat with kind=image has no library match — Director can
 *    request one of these on the fly.
 */

const BUCKET = "animation-cache";

function getAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function dataUrlToBuffer(dataUrl: string): { buf: Uint8Array; contentType: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid data URL from image gateway");
  const contentType = m[1];
  const binary = atob(m[2]);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return { buf, contentType };
}

async function callImageGateway(prompt: string, model: string): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 429) throw new Error("Image rate limit — please retry shortly.");
    if (res.status === 402) throw new Error("Image credits exhausted — top up Lovable AI workspace.");
    throw new Error(`Image gateway ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  const url = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("Image gateway returned no image");
  return url;
}

export const generateAssetImage = createServerFn({ method: "POST" })
  .inputValidator((d: {
    projectId: string;
    sceneId?: string;
    prompt: string;
    style?: "illustration" | "icon" | "photo" | "diagram";
    quality?: "fast" | "high";
    sourceWord?: string;
  }) =>
    z
      .object({
        projectId: z.string().uuid(),
        sceneId: z.string().uuid().optional(),
        prompt: z.string().min(3).max(400),
        style: z.enum(["illustration", "icon", "photo", "diagram"]).optional(),
        quality: z.enum(["fast", "high"]).optional(),
        sourceWord: z.string().max(60).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const admin = getAdmin();

    // Compose a richer prompt based on style.
    const styleHint =
      data.style === "icon"
        ? "Clean modern flat icon, single subject, transparent or solid background, no text, vibrant flat colors."
        : data.style === "photo"
          ? "Photorealistic, soft natural lighting, shallow depth of field."
          : data.style === "diagram"
            ? "Minimal infographic illustration, clear shapes, labels OK, neutral palette."
            : "Friendly modern illustration, vibrant colors, clean composition, no text.";

    const fullPrompt = `${data.prompt}\n\nStyle: ${styleHint}\nAspect: 16:9, centered subject with breathing room.`;

    const model =
      data.quality === "high"
        ? "google/gemini-3-pro-image-preview"
        : "google/gemini-3.1-flash-image-preview";

    const dataUrl = await callImageGateway(fullPrompt, model);
    const { buf, contentType } = dataUrlToBuffer(dataUrl);
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const id = crypto.randomUUID();
    const path = `ai-generated/${data.projectId}/${id}.${ext}`;

    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, {
      contentType,
      upsert: true,
    });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    const shortName = data.prompt.length > 60 ? data.prompt.slice(0, 57) + "…" : data.prompt;
    const slug = `ai-${id}`;
    const tags = [
      "ai-generated",
      data.style ?? "illustration",
      ...(data.sourceWord ? [data.sourceWord.toLowerCase()] : []),
    ];

    const { data: inserted, error } = await admin
      .from("animation_components")
      .insert({
        slug,
        name: shortName,
        category: "AI Generated",
        provider: "ai-image",
        external_id: id,
        thumbnail_url: publicUrl,
        color_support: "fixed",
        tags,
        default_props: {
          asset_type: "ai-image",
          image_url: publicUrl,
          source_prompt: data.prompt,
          source_word: data.sourceWord ?? null,
          style: data.style ?? "illustration",
        },
      })
      .select("id, name, slug, thumbnail_url")
      .single();
    if (error) throw new Error(error.message);

    return {
      id: inserted.id,
      name: inserted.name,
      slug: inserted.slug,
      url: publicUrl,
      thumbnail_url: inserted.thumbnail_url,
    };
  });
