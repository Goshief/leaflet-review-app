import { decodeHtmlEntities, htmlToText, metaContent, tagText } from "./html.ts";
import type { CatalogProduct } from "./types.ts";

export const TETA_BASE_URL = "https://www.tetadrogerie.cz";
export const TETA_ROBOTS_URL = `${TETA_BASE_URL}/robots.txt`;
export const TETA_SITEMAP_URL = `${TETA_BASE_URL}/sitemap_index.xml`;

const PRODUCT_PATH = /^\/eshop\/katalog\//i;

function decimal(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function lines(text: string) {
  return text.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function priceFromLine(line: string) {
  const hit = line.match(/^(\d{1,6}(?:[\s.]\d{3})*(?:,\d{2}|\.\d{2}))\s*Kč$/i);
  return hit ? decimal(hit[1]) : null;
}

function unitPriceFromLine(line: string) {
  const hit = line.match(/^(\d{1,9}(?:[\s.]\d{3})*(?:,\d{2}|\.\d{2}))\s*Kč\s*\/\s*(KS|KG|LIT|L|M|100\s*G|100\s*ML|10\s*ML)/i);
  if (!hit) return { price: null, basis: null };
  return { price: decimal(hit[1]), basis: hit[2].replace(/\s+/g, " ").toUpperCase() };
}

function quantityFromName(name: string) {
  const multipack = name.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml)\b/i);
  if (multipack) {
    const count = Number(multipack[1]);
    const each = decimal(multipack[2]);
    if (Number.isFinite(count) && each != null) return { value: count * each, unit: multipack[3].toLowerCase() };
  }
  const direct = [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|ks|kus(?:ů|u|y)?)/gi)].at(-1);
  if (!direct) return { value: null, unit: null };
  const unit = direct[2].toLowerCase();
  return {
    value: decimal(direct[1]),
    unit: /^ks|^kus/.test(unit) ? "kus" : unit,
  };
}

function fieldValue(allLines: string[], label: string) {
  const normalizedLabel = label.toLocaleLowerCase("cs-CZ");
  for (let i = 0; i < allLines.length; i += 1) {
    const line = allLines[i];
    const lower = line.toLocaleLowerCase("cs-CZ");
    if (lower === normalizedLabel) return allLines[i + 1] ?? null;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const inline = line.match(new RegExp(`^${escaped}\\s*[|:]\\s*(.+)$`, "i"));
    if (inline?.[1]) return inline[1].trim();
  }
  return null;
}

function productBlock(allLines: string[], name: string) {
  const start = allLines.findIndex((line) => line === name);
  if (start < 0) return allLines;
  const result = allLines.slice(start, start + 45);
  const codeIndex = result.findIndex((line) => /^Kód\s*:/i.test(line));
  return codeIndex >= 0 ? result.slice(0, codeIndex + 1) : result;
}

export function extractTetaSitemapLocations(xml: string) {
  const locations: string[] = [];
  for (const match of xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)) {
    const value = decodeHtmlEntities((match[1] || "").trim());
    if (value) locations.push(value);
  }
  return locations;
}

export function splitTetaSitemap(xml: string) {
  const productUrls: string[] = [];
  const childSitemaps: string[] = [];
  for (const raw of extractTetaSitemapLocations(xml)) {
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || !/^(?:www\.)?tetadrogerie\.cz$/i.test(url.hostname)) continue;
      if (PRODUCT_PATH.test(url.pathname)) productUrls.push(url.toString());
      else if (/\.xml$/i.test(url.pathname)) childSitemaps.push(url.toString());
    } catch {
      // Ignore malformed sitemap rows.
    }
  }
  return { productUrls: [...new Set(productUrls)], childSitemaps: [...new Set(childSitemaps)] };
}

export function parseTetaProductPage(html: string, sourceUrl: string): CatalogProduct {
  const name = tagText(html, "h1");
  if (!name) throw new Error("Teta product page: missing h1 product name");
  const allText = htmlToText(html);
  const allLines = lines(allText);
  const block = productBlock(allLines, name);
  const code = block.map((line) => line.match(/^Kód\s*:\s*(\d+)/i)?.[1] ?? null).find(Boolean)
    ?? allText.match(/Kód\s*:\s*(\d+)/i)?.[1]
    ?? null;
  if (!code) throw new Error("Teta product page: missing product code");

  const prices: number[] = [];
  let unitPrice: number | null = null;
  let unitBasis: string | null = null;
  for (const line of block) {
    const unit = unitPriceFromLine(line);
    if (unit.price != null && unitPrice == null) {
      unitPrice = unit.price;
      unitBasis = unit.basis;
      continue;
    }
    const value = priceFromLine(line);
    if (value != null && !prices.includes(value)) prices.push(value);
  }
  if (!prices.length) throw new Error("Teta product page: missing public price");
  const regularPrice = prices.length >= 2 ? prices[0] : prices[0];
  const price = prices.length >= 2 ? prices[1] : prices[0];
  const pack = quantityFromName(name);
  const brand = fieldValue(allLines, "Značka")
    ?? (() => {
      const nameIndex = allLines.findIndex((line) => line === name);
      const previous = nameIndex > 0 ? allLines[nameIndex - 1] : null;
      return previous && previous.length <= 60 && !/infolinka|menu|košík/i.test(previous) ? previous : null;
    })();
  const country = fieldValue(allLines, "Země původu");
  const available = /Dostupné online/i.test(block.join("\n"));

  return {
    retailerId: "teta",
    externalId: code,
    sourceUrl,
    name,
    brand,
    sku: code,
    gtin: allText.match(/(?:EAN|GTIN)\s*[:|]?\s*(\d{8,14})/i)?.[1] ?? null,
    quantityValue: pack.value,
    quantityUnit: pack.unit,
    imageUrl: metaContent(html, "og:image"),
    category: null,
    countryOfOrigin: country,
    metadata: {
      product_code: code,
      parser: "teta-html-v1",
    },
    offer: {
      price,
      regularPrice,
      loyaltyPrice: null,
      unitPrice,
      unitBasis,
      currency: "CZK",
      available,
    },
  };
}
