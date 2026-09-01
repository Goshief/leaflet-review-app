export function decimal(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const normalized = String(value).replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function quantityFromName(name: string) {
  const multipack = name.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml)\b/i);
  if (multipack) {
    const count = Number(multipack[1]);
    const each = decimal(multipack[2]);
    if (Number.isFinite(count) && each != null) return { value: count * each, unit: multipack[3].toLowerCase() };
  }
  const direct = [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|ks|kus(?:ů|u|y)?)\b/gi)].at(-1);
  if (!direct) return { value: null, unit: null };
  return {
    value: decimal(direct[1]),
    unit: /^(?:ks|kus)/i.test(direct[2]) ? "kus" : direct[2].toLowerCase(),
  };
}

export function quantityFromPackText(value: string | null | undefined) {
  if (!value) return { value: null, unit: null };
  return quantityFromName(value);
}

type JsonLdNode = Record<string, unknown>;

function asNodes(value: unknown): JsonLdNode[] {
  if (!value || typeof value !== "object") return [];
  return Array.isArray(value) ? value.filter((item): item is JsonLdNode => Boolean(item) && typeof item === "object") : [value as JsonLdNode];
}

function nodeType(node: JsonLdNode) {
  const raw = node["@type"];
  if (typeof raw === "string") return raw.toLowerCase();
  if (Array.isArray(raw)) return raw.map((item) => String(item).toLowerCase()).join(" ");
  return "";
}

export function jsonLdBlocks(html: string): JsonLdNode[] {
  const blocks: JsonLdNode[] = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1] || "null") as unknown;
      if (Array.isArray(parsed)) blocks.push(...asNodes(parsed));
      else if (parsed && typeof parsed === "object") blocks.push(parsed as JsonLdNode);
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return blocks;
}

export function jsonLdProducts(html: string): JsonLdNode[] {
  const products: JsonLdNode[] = [];
  for (const block of jsonLdBlocks(html)) {
    if (nodeType(block).includes("product")) products.push(block);
    for (const nested of asNodes(block["@graph"])) {
      if (nodeType(nested).includes("product")) products.push(nested);
    }
  }
  return products;
}

export function jsonLdBrand(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  for (const node of asNodes(value)) {
    const name = typeof node.name === "string" ? node.name.trim() : "";
    if (name) return name;
  }
  return null;
}

export function jsonLdOffer(product: JsonLdNode) {
  const offer = asNodes(product.offers)[0] ?? null;
  if (!offer) return { price: null, currency: "CZK", available: false, url: null as string | null };
  const availability = String(offer.availability ?? "")
    .toLowerCase()
    .replace(/^https?:\/\/schema\.org\//, "")
    .replace(/[^a-z]/g, "");
  const available =
    availability === "instock" ||
    availability === "limitedavailability" ||
    availability === "onlineonly" ||
    availability === "presale";
  return {
    price: decimal(typeof offer.price === "number" || typeof offer.price === "string" ? offer.price : null),
    currency: typeof offer.priceCurrency === "string" && offer.priceCurrency ? offer.priceCurrency : "CZK",
    available,
    url: typeof offer.url === "string" ? offer.url : null,
  };
}

export function jsonLdImage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object" && typeof (item as JsonLdNode).url === "string") {
        return String((item as JsonLdNode).url);
      }
    }
  }
  if (value && typeof value === "object" && typeof (value as JsonLdNode).url === "string") {
    return String((value as JsonLdNode).url);
  }
  return null;
}

export function jsonLdGtin(product: JsonLdNode): string | null {
  for (const key of ["gtin13", "gtin14", "gtin12", "gtin8", "gtin", "ean"]) {
    const value = product[key];
    if (typeof value === "string" && /^\d{8,14}$/.test(value.trim())) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function jsonLdText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  return null;
}
