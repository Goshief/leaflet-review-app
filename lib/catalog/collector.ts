import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type CollectedProduct = {
  name: string;
  description: string | null;
  brand: string | null;
  sku: string | null;
  gtin: string | null;
  category: string | null;
  price: number | null;
  price_currency: string | null;
  price_standard: number | null;
  availability: string | null;
  source_url: string;
  image_source_url: string | null;
  image_storage_path: string | null;
};

export type CatalogSnapshot = {
  id: string;
  fetched_at: string;
  source_url: string;
  final_url: string;
  host: string;
  title: string | null;
  source_html_path: string | null;
  manifest_path: string | null;
  product: CollectedProduct;
};

const MAX_HTML = 5 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function num(value: unknown): number | null {
  const valueText = str(value)?.replace(/\s/g, "").replace(",", ".");
  if (!valueText) return null;
  const parsed = Number(valueText);
  return Number.isFinite(parsed) ? parsed : null;
}

function privateIp(value: string): boolean {
  const host = value.replace(/^\[|\]$/g, "").toLowerCase();
  if (!isIP(host)) return false;
  return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:") ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "0.0.0.0";
}

export async function publicUrl(input: string): Promise<URL> {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Zadej platnou URL včetně https://."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Podporované jsou pouze HTTP a HTTPS adresy.");
  if (url.username || url.password) throw new Error("URL nesmí obsahovat přihlašovací údaje.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || privateIp(hostname)) throw new Error("Lokální a privátní adresy nejsou povolené.");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => privateIp(entry.address))) throw new Error("Doména vede na privátní adresu.");
  return url;
}

function meta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const pattern of [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ]) {
    const match = html.match(pattern);
    if (match?.[1]) return decode(match[1]);
  }
  return null;
}

function decode(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function productNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(productNodes);
  if (!value || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  const types = (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]).map(str);
  const own = types.some((type) => /^(product|productgroup)$/i.test(type ?? "")) ? [node] : [];
  return [...own, ...productNodes(node["@graph"]), ...productNodes(node.itemListElement)];
}

function jsonLdProduct(html: string): Record<string, unknown> | null {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const product = productNodes(JSON.parse(match[1].trim()))[0];
      if (product) return product;
    } catch { /* Third-party invalid JSON-LD is ignored. */ }
  }
  return null;
}

function absolute(value: unknown, base: URL): string | null {
  const raw = str(Array.isArray(value) ? value[0] : value);
  if (!raw) return null;
  try { return new URL(raw, base).toString(); } catch { return null; }
}

export function parseProductHtml(html: string, finalUrl: string): Omit<CatalogSnapshot, "id" | "fetched_at" | "source_url" | "source_html_path" | "manifest_path"> {
  const base = new URL(finalUrl);
  const node = jsonLdProduct(html) ?? {};
  const offerNode = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  const offer = offerNode && typeof offerNode === "object" ? offerNode as Record<string, unknown> : {};
  const brandNode = node.brand && typeof node.brand === "object" ? node.brand as Record<string, unknown> : {};
  const title = meta(html, "og:title") ?? (decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || null);
  const name = str(node.name) ?? title;
  if (!name) throw new Error("Na stránce nebyl nalezen název produktu.");
  const image = absolute(node.image, base) ?? absolute(meta(html, "og:image"), base);
  return {
    final_url: base.toString(),
    host: base.hostname,
    title,
    product: {
      name,
      description: str(node.description) ?? meta(html, "og:description"),
      brand: str(brandNode.name ?? node.brand),
      sku: str(node.sku ?? node.mpn),
      gtin: str(node.gtin ?? node.gtin13 ?? node.gtin14 ?? node.gtin8),
      category: str(node.category),
      price: num(offer.price ?? offer.lowPrice ?? meta(html, "product:price:amount")),
      price_currency: str(offer.priceCurrency ?? meta(html, "product:price:currency"))?.toUpperCase() ?? null,
      price_standard: num(offer.highPrice),
      availability: str(offer.availability ?? meta(html, "product:availability"))?.split("/").pop() ?? null,
      source_url: base.toString(),
      image_source_url: image,
      image_storage_path: null,
    },
  };
}

async function limitedFetch(url: URL, accept: string, maxBytes: number, redirects = 0): Promise<{ response: Response; bytes: Uint8Array }> {
  if (redirects > 5) throw new Error("Zdroj překročil limit 5 přesměrování.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { Accept: accept, "User-Agent": "VerastraCatalogCollector/1.0" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Zdroj vrátil neplatné přesměrování.");
      const redirected = await publicUrl(new URL(location, url).toString());
      return limitedFetch(redirected, accept, maxBytes, redirects + 1);
    }
    if (!response.ok) throw new Error(`Zdroj vrátil HTTP ${response.status}.`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Error("Stažený obsah překročil povolenou velikost.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("Stažený obsah překročil povolenou velikost.");
    return { response, bytes };
  } finally { clearTimeout(timer); }
}

export async function collectProductPage(input: string): Promise<{ snapshot: CatalogSnapshot; html: Uint8Array; image: { bytes: Uint8Array; mime: string; extension: string } | null }> {
  const source = await publicUrl(input);
  const page = await limitedFetch(source, "text/html,application/xhtml+xml", MAX_HTML);
  const type = page.response.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error("URL nevrátila HTML stránku.");
  const finalUrl = page.response.url || source.toString();
  const parsed = parseProductHtml(new TextDecoder().decode(page.bytes), finalUrl);
  const id = createHash("sha256").update(new URL(finalUrl).toString()).digest("hex").slice(0, 24);
  let image: { bytes: Uint8Array; mime: string; extension: string } | null = null;
  if (parsed.product.image_source_url) {
    const imageUrl = await publicUrl(parsed.product.image_source_url);
    const loaded = await limitedFetch(imageUrl, "image/jpeg,image/png,image/webp,image/avif", MAX_IMAGE);
    const mime = (loaded.response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" } as Record<string, string>)[mime];
    if (!extension) throw new Error(`Obrázek má nepodporovaný typ ${mime || "unknown"}.`);
    image = { bytes: loaded.bytes, mime, extension };
  }
  return {
    snapshot: { id, fetched_at: new Date().toISOString(), source_url: source.toString(), source_html_path: null, manifest_path: null, ...parsed },
    html: page.bytes,
    image,
  };
}
