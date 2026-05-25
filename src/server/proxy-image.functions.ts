import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Allowed hostnames (suffix match) for the image proxy. Restricts the
 * server-side fetch to known image/CDN hosts to prevent SSRF against
 * internal services or cloud metadata endpoints.
 */
const ALLOWED_HOST_SUFFIXES = [
  "supabase.co",
  "supabase.in",
  "iconscout.com",
  "cdn-icons.iconscout.com",
  "unsplash.com",
  "images.unsplash.com",
  "freepik.com",
  "img.freepik.com",
  "lottiefiles.com",
  "assets.lottiefiles.com",
  "googleusercontent.com",
  "cloudinary.com",
  "imgix.net",
  "githubusercontent.com",
];

function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // IPv6 loopback / unspecified / link-local
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  // IPv4 dotted-quad checks
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast / reserved
  }
  return false;
}

function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => h === suffix || h.endsWith(`.${suffix}`),
  );
}

/**
 * Fetches an external URL server-side and returns a base64 data URL.
 * Used by the canvas exporter to avoid tainted-canvas errors when the
 * remote image host doesn't send CORS headers.
 *
 * SSRF hardening: only http(s), allowlisted hostnames, no private IPs.
 */
export const proxyImageAsDataUrl = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ url: z.string().url().max(2048) }).parse(d),
  )
  .handler(async ({ data }) => {
    let parsed: URL;
    try {
      parsed = new URL(data.url);
    } catch {
      throw new Error("invalid url");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    if (isPrivateOrLoopbackHost(parsed.hostname)) {
      throw new Error("host not allowed");
    }
    if (!isAllowedHost(parsed.hostname)) {
      throw new Error("host not allowed");
    }

    const res = await fetch(parsed.toString(), { redirect: "error" });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const ct = res.headers.get("content-type") ?? "image/png";
    if (!/^image\//i.test(ct) && !/^application\/(json|octet-stream)$/i.test(ct)) {
      // Restrict to image-like responses to limit abuse.
      if (!ct.startsWith("image/")) throw new Error("unsupported content-type");
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);
    return { dataUrl: `data:${ct};base64,${b64}` };
  });
