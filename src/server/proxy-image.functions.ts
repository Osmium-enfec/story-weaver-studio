import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Fetches an external URL server-side and returns a base64 data URL.
 * Used by the canvas exporter to avoid tainted-canvas errors when the
 * remote image host doesn't send CORS headers.
 */
export const proxyImageAsDataUrl = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ url: z.string().url() }).parse(d))
  .handler(async ({ data }) => {
    const res = await fetch(data.url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const ct = res.headers.get("content-type") ?? "image/png";
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);
    return { dataUrl: `data:${ct};base64,${b64}` };
  });
