import { decodeHtmlEntities, htmlToText, metaContent, tagText } from "./html.ts";
import type { CatalogProduct } from "./types.ts";

export const DM_BASE_URL = "https://www.dm.cz";
export const DM_ROBOTS_URL = `${DM_BASE_URL}/robots.txt`;
export const DM_SITEMAP_URL = `${DM_BASE_URL}/sitemap.xml`;

const PRODUCT_PATH = /^\/p\/d\/\d+(?:\/|$)/i;
const PRODUCT_URL_ID = /^\/p\/d\/(\d+)(?:\/|$)/i;

function decimal(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function cleanLines(value: string) {
  return value.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function h1Parts(html: string) {
  const hit = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!hit) return { name: null, brand: null };
  const inner = hit[1] ?? "";
  const name = htmlToText(inner).replace(/\s+/g, " ").trim() || null;
  const anchor = inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
  const brand = anchor?.[1] ? htmlToText(anchor[1]).replace(/\s+/g, " ").trim() || null : null;
  return { name, brand };
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
  return {
    value: decimal(direct[1]),
    unit: /^(?:ks|kus)/i.test(direct[2]) ? "kus" : direct[2].toLowerCase(),
  };
}

function fieldAfter(lines: string[], label: RegExp) {
  const index = lines.findIndex((line) => label.test(line));
  if (index < 0) return null;
  return lines[index + 1] ?? null;
}

function unitData(text: string) {
  const hit = text.match(
    /(\d+(?:[\s.]\d{3})*(?:[.,]\d+)?)\s*(kg|g|l|ml|ks|kus)\s*\(\s*(\d+(?:[\s.]\d{3})*(?:[.,]\d{2}))\s*Kč\s+za\s+(\d+(?:[\s.]\d{3})*(?:[.,]\d+)?)\s*(kg|g|l|ml|ks|kus)\s*\)/i
  );
  if (!hit) return { packValue: null, packUnit: null, unitPrice: null, unitBasis: null };
  return {
    packValue: decimal(hit[1]),
    packUnit: /^(?:ks|kus)$/i.test(hit[2]) ? "kus" : hit[2].toLowerCase(),
    unitPrice: decimal(hit[3]),
    unitBasis: `${hit[4].replace(/\s+/g, " ")} ${/^(?:ks|kus)$/i.test(hit[5]) ? "kus" : hit[5].toLowerCase()}`,
  };
}

export function extractDmSitemapLocations(xml: string) {
  const locations: string[] = [];
  for (const match of xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)) {
    const value = decodeHtmlEntities((match[1] || "").trim());
    if (value) locations.push(value);
  }
  return locations;
}

export function splitDmSitemap(xml: string) {
  const productUrls: string[] = [];
  const childSitemaps: string[] = [];
  for (const raw of extractDmSitemapLocations(xml)) {
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || !/^(?:www\.)?dm\.cz$/i.test(url.hostname)) continue;
      if (PRODUCT_PATH.test(url.pathname)) productUrls.push(url.toString());
      else if (/\.xml$/i.test(url.pathname)) childSitemaps.push(url.toString());
    } catch {
      // Ignore malformed sitemap rows.
    }
  }
  return { productUrls: [...new Set(productUrls)], childSitemaps: [...new Set(childSitemaps)] };
}

export function dmExternalIdFromUrl(sourceUrl: string) {
  try {
    return new URL(sourceUrl).pathname.match(PRODUCT_URL_ID)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function parseDmProductPage(html: string, sourceUrl: string): CatalogProduct {
  const h1 = h1Parts(html);
  const name = h1.name ?? tagText(html, "h1");
  if (!name) throw new Error("dm product page: missing h1 product name");

  const fullText = htmlToText(html);
  const allLines = cleanLines(fullText);
  const sku = fullText.match(/číslo\s+produktu\s+dm\s*:\s*(\d+)/i)?.[1] ?? dmExternalIdFromUrl(sourceUrl);
  if (!sku) throw new Error("dm product page: missing product number");
  const gtin = fullText.match(/GTIN\s*:\s*(\d{8,14})/i)?.[1] ?? null;

  const currentPrice = decimal(fullText.match(/Aktuální\s+cena\s*:\s*([\d\s.,]+)\s*Kč/i)?.[1]);
  const originalPrice = decimal(fullText.match(/Původní\s+cena\s*:\s*([\d\s.,]+)\s*Kč/i)?.[1]);
  if (currentPrice == null) throw new Error("dm product page: missing current price");

  const unit = unitData(fullText);
  const namePack = quantityFromName(name);
  const packValue = unit.packValue ?? namePack.value;
  const packUnit = unit.packUnit ?? namePack.unit;
  const unavailable = /Momentálně\s+není\s+skladem/i.test(fullText);
  const available = unavailable ? false : /(?:^|\n)Skladem(?:\n|$)/im.test(fullText);
  const country = fieldAfter(allLines, /^Vyrobeno\s+v$/i);

  let brand = h1.brand;
  if (!brand) {
    const nameStart = name.split(/\s+/)[0] ?? "";
    if (nameStart && nameStart.length <= 40 && /^[\p{L}\p{N}._&+-]+$/u.test(nameStart)) brand = nameStart;
  }

  return {
    retailerId: "dm",
    externalId: sku,
    sourceUrl,
    name,
    brand,
    sku,
    gtin,
    quantityValue: packValue,
    quantityUnit: packUnit,
    imageUrl: metaContent(html, "og:image"),
    category: null,
    countryOfOrigin: country,
    metadata: {
      product_number_dm: sku,
      parser: "dm-html-v1",
    },
    offer: {
      price: currentPrice,
      regularPrice: originalPrice ?? currentPrice,
      loyaltyPrice: null,
      unitPrice: unit.unitPrice,
      unitBasis: unit.unitBasis,
      currency: "CZK",
      available,
    },
  };
}
