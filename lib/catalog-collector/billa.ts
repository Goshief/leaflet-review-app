import { decodeHtmlEntities, htmlToText, metaContent, tagText } from "./html.ts";
import type { CatalogProduct } from "./types.ts";

export const BILLA_BASE_URL = "https://www.billa.cz";
export const BILLA_ROBOTS_URL = `${BILLA_BASE_URL}/robots.txt`;
export const BILLA_SITEMAP_URL = `${BILLA_BASE_URL}/sitemap.xml`;

const PRODUCT_PATH = /^\/produkt\//i;
const PRODUCT_URL_ID = /-(\d{6,})\/?$/;

function decimal(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function cleanLines(text: string) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

function priceLine(line: string) {
  const hit = line.match(/^(?:cca\s*)?(\d{1,6}(?:[.,]\d{2}))\s*Kč$/i);
  return hit ? decimal(hit[1]) : null;
}

function firstPriceAfter(lines: string[], label: RegExp) {
  const start = lines.findIndex((line) => label.test(line));
  if (start < 0) return null;
  for (const line of lines.slice(start + 1, start + 6)) {
    const hit = priceLine(line);
    if (hit != null) return hit;
  }
  return null;
}

function packFromLines(lines: string[]) {
  for (const line of lines) {
    const hit = line.match(/^(?:min\.\s*|cca\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|kus|ks)$/i);
    if (!hit) continue;
    return {
      value: decimal(hit[1]),
      unit: hit[2].toLowerCase() === "ks" ? "kus" : hit[2].toLowerCase(),
    };
  }
  return { value: null, unit: null };
}

function unitPriceFromLines(lines: string[]) {
  for (const line of lines) {
    const hit = line.match(/^(1\s*(?:kg|l|ks|kus)|100\s*g)\s+(\d{1,6}(?:[.,]\d{2}))\s*Kč/i);
    if (!hit) continue;
    return { basis: hit[1].replace(/\s+/g, " "), price: decimal(hit[2]) };
  }
  return { basis: null, price: null };
}

function articleNumber(text: string) {
  const hit = text.match(/Artiklov[eé]\s*č\.?\s*:\s*([0-9-]{5,})/i);
  const raw = hit?.[1]?.trim();
  return raw ? raw.replace(/\D/g, "") : null;
}

function externalIdFromUrl(sourceUrl: string) {
  try {
    return new URL(sourceUrl).pathname.match(PRODUCT_URL_ID)?.[1] ?? null;
  } catch {
    return null;
  }
}

function productTextBlock(html: string, name: string) {
  const lower = html.toLowerCase();
  const h1Index = lower.indexOf("<h1");
  if (h1Index < 0) return cleanLines(htmlToText(html));
  const aboutCandidates = ["o produktu", "artiklové č", "artiklove c"];
  let end = Math.min(html.length, h1Index + 45000);
  const tailLower = lower.slice(h1Index);
  for (const marker of aboutCandidates) {
    const pos = tailLower.indexOf(marker);
    if (pos > 0) end = Math.min(end, h1Index + pos);
  }
  const lines = cleanLines(htmlToText(html.slice(h1Index, end)));
  const firstName = lines.findIndex((line) => line === name);
  return firstName >= 0 ? lines.slice(firstName) : lines;
}

function brandFromBlock(lines: string[], name: string) {
  const skip = [
    /^Běžná cena$/i,
    /^S BILLA klub/i,
    /^O produktu$/i,
    /^Klikněte na obrázek/i,
    /^zoom/i,
    /^image$/i,
  ];
  for (const line of lines.slice(1, 8)) {
    if (line === name) continue;
    if (skip.some((re) => re.test(line))) continue;
    if (/^(?:min\.\s*|cca\s*)?\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|kus|ks)$/i.test(line)) continue;
    if (/Kč/i.test(line)) continue;
    if (line.length > 80) continue;
    return line;
  }
  return null;
}

function countryFromText(text: string) {
  const lines = cleanLines(text);
  const index = lines.findIndex((line) => /^Země původu$/i.test(line));
  if (index < 0) return null;
  return lines[index + 1] ?? null;
}

export function extractSitemapLocations(xml: string) {
  const locations: string[] = [];
  for (const match of xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)) {
    const value = decodeHtmlEntities((match[1] || "").trim());
    if (value) locations.push(value);
  }
  return locations;
}

export function splitBillaSitemap(xml: string) {
  const locations = extractSitemapLocations(xml);
  const productUrls: string[] = [];
  const childSitemaps: string[] = [];
  for (const raw of locations) {
    try {
      const url = new URL(raw);
      if (!/^https:$/.test(url.protocol)) continue;
      if (!/^(?:www\.)?billa\.cz$/i.test(url.hostname)) continue;
      if (PRODUCT_PATH.test(url.pathname)) productUrls.push(url.toString());
      else if (/\.xml(?:$|\?)/i.test(url.pathname + url.search)) childSitemaps.push(url.toString());
    } catch {
      // Ignore malformed sitemap entries.
    }
  }
  return {
    productUrls: [...new Set(productUrls)],
    childSitemaps: [...new Set(childSitemaps)],
  };
}

type RobotsRule = { allow: boolean; path: string };

function wildcardRules(robots: string) {
  const rules: RobotsRule[] = [];
  let applies = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const split = line.indexOf(":");
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();
    if (key === "user-agent") {
      applies = value === "*";
      continue;
    }
    if (!applies || (key !== "allow" && key !== "disallow") || !value) continue;
    rules.push({ allow: key === "allow", path: value });
  }
  return rules;
}

export function robotsAllowsPath(robots: string, pathname: string) {
  const matches = wildcardRules(robots)
    .filter((rule) => pathname.startsWith(rule.path))
    .sort((a, b) => b.path.length - a.path.length);
  return matches[0]?.allow ?? true;
}

export function parseBillaProductPage(html: string, sourceUrl: string): CatalogProduct {
  const name = tagText(html, "h1");
  if (!name) throw new Error("BILLA product page: missing h1 product name");

  const fullText = htmlToText(html);
  const block = productTextBlock(html, name);
  const article = articleNumber(fullText);
  const externalId = article ?? externalIdFromUrl(sourceUrl);
  if (!externalId) throw new Error("BILLA product page: missing external product id");

  const regularPrice = firstPriceAfter(block, /^Běžná cena$/i);
  const loyaltyPrice = firstPriceAfter(block, /^S BILLA klub/i);
  let publicPrice: number | null = null;
  for (const line of block) {
    const hit = priceLine(line);
    if (hit != null) {
      publicPrice = hit;
      break;
    }
  }
  if (regularPrice != null) publicPrice = regularPrice;

  const pack = packFromLines(block.slice(0, 18));
  const unit = unitPriceFromLines(block.slice(0, 24));
  const imageUrl = metaContent(html, "og:image");
  const unavailable = /není\s+(?:momentálně\s+)?dostupn|není\s+v\s+nabídce/i.test(fullText);

  return {
    retailerId: "billa",
    externalId,
    sourceUrl,
    name,
    brand: brandFromBlock(block, name),
    sku: article,
    gtin: fullText.match(/(?:EAN|GTIN)\s*:?\s*(\d{8,14})/i)?.[1] ?? null,
    quantityValue: pack.value,
    quantityUnit: pack.unit,
    imageUrl,
    category: null,
    countryOfOrigin: countryFromText(fullText),
    metadata: {
      article_number: article,
      parser: "billa-html-v1",
    },
    offer: {
      price: publicPrice,
      regularPrice,
      loyaltyPrice,
      unitPrice: unit.price,
      unitBasis: unit.basis,
      currency: "CZK",
      available: !unavailable && publicPrice != null,
    },
  };
}

export function billaExternalIdFromUrl(sourceUrl: string) {
  return externalIdFromUrl(sourceUrl);
}
