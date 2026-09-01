import { gunzipSync } from "node:zlib";
import type { CatalogAdapter, FetchedText } from "./types";

export const CATALOG_USER_AGENT = "SetrikCatalogBot/1.0 (+https://leaflet-review-app.vercel.app)";

export function requireAdapterUrl(adapter: CatalogAdapter, raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !adapter.hostPattern.test(url.hostname)) {
    throw new Error(`Catalog collector rejected non-${adapter.retailer} URL: ${url.hostname}`);
  }
  return url;
}

function decodeBody(url: URL, contentType: string, bytes: Buffer) {
  const looksGzip =
    /\.gz(?:$|\?)/i.test(url.pathname + url.search) ||
    /application\/(?:gzip|x-gzip)/i.test(contentType);
  if (!looksGzip) return bytes.toString("utf8");
  try {
    return gunzipSync(bytes).toString("utf8");
  } catch {
    return bytes.toString("utf8");
  }
}

export async function fetchAdapterText(
  adapter: CatalogAdapter,
  urlValue: string,
  maxBytes = 5_000_000
): Promise<FetchedText> {
  const url = requireAdapterUrl(adapter, urlValue);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": CATALOG_USER_AGENT,
        Accept: "text/html,application/xml,text/xml,text/plain,application/gzip;q=0.9,*/*;q=0.5",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
      },
    }).catch((error: unknown) => {
      const cause = error instanceof Error && "cause" in error ? error.cause : null;
      const extra = cause instanceof Error ? cause.message : cause ? String(cause) : "";
      throw new Error(`fetch failed for ${url}: ${error instanceof Error ? error.message : String(error)}${extra ? ` (${extra})` : ""}`);
    });
    const finalUrl = requireAdapterUrl(adapter, response.url || url.toString());
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxBytes) throw new Error(`Response too large: ${contentLength} bytes`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error(`Response too large after download: ${bytes.length} bytes`);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${finalUrl}`);
    const contentType = response.headers.get("content-type") || "";
    const body = decodeBody(finalUrl, contentType, bytes);
    if (body.length > maxBytes) throw new Error(`Response too large after decode: ${body.length} chars`);
    return {
      requestedUrl: url.toString(),
      finalUrl: finalUrl.toString(),
      status: response.status,
      contentType,
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}
