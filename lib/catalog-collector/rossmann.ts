import { htmlToText, metaContent, tagText } from "./html.ts";
import type { CatalogAdapter } from "./generic-runner.ts";
import { decimal, quantityFromName, quantityFromPackText } from "./parse.ts";
import { splitRetailerSitemap } from "./sitemap.ts";
import type { CatalogProduct } from "./types.ts";

export const ROSSMANN_BASE_URL = "https://www.rossmann.cz";
export const ROSSMANN_ROBOTS_URL = `${ROSSMANN_BASE_URL}/robots.txt`;
export const ROSSMANN_SITEMAP_URL = `${ROSSMANN_BASE_URL}/sitemap.xml`;

const PRODUCT_PATH = /^\/[a-z0-9-]+\/?$/i;

function jsStringField(source: string, key: string) {
  const hit = source.match(new RegExp(`${key}:"((?:\\\\.|[^"\\\\])*)"`));
  if (!hit?.[1]) return null;
  try {
    return JSON.parse(`"${hit[1]}"`) as string;
  } catch {
    return hit[1];
  }
}

function dataLayerItem(html: string) {
  const hit = html.match(/dataLayer\.push\(\{event:"ec_detail_view",ecommerce:\{items:\[(\{[\s\S]*?\})\]/);
  if (!hit?.[1]) return null;
  const source = hit[1];
  return {
    item_id: jsStringField(source, "item_id"),
    item_name: jsStringField(source, "item_name"),
    item_brand: jsStringField(source, "item_brand"),
    item_variant: jsStringField(source, "item_variant"),
    item_category: jsStringField(source, "item_category"),
    priceVAT: jsStringField(source, "priceVAT"),
    availability: jsStringField(source, "availability"),
  };
}

export function splitRossmannSitemap(xml: string) {
  return splitRetailerSitemap(xml, rossmannAdapter);
}

export function parseRossmannProductPage(html: string, sourceUrl: string): CatalogProduct {
  const item = dataLayerItem(html);
  const name = (item?.item_name || tagText(html, "h1") || "").replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Rossmann product page: missing product name");

  const fullText = htmlToText(html);
  const sku =
    item?.item_id?.trim() ||
    fullText.match(/Obj\.\s*č\.:\s*(\d+)/i)?.[1] ||
    null;
  if (!sku) throw new Error("Rossmann product page: missing product id");

  const gtin = fullText.match(/EAN\s*(\d{8,14})/i)?.[1] ?? null;
  const price =
    decimal(item?.priceVAT) ??
    decimal(fullText.match(/(\d+(?:[.,]\d{2}))\s*Kč/i)?.[1]);
  if (price == null) throw new Error("Rossmann product page: missing public price");

  const unitHit = fullText.match(/Běžná cena:\s*(\d+(?:[.,]\d+))\s*Kč\/(\d+\s*(?:g|kg|ml|l|ks))/i);
  const fromVariant = quantityFromPackText(item?.item_variant);
  const pack = fromVariant.value != null ? fromVariant : quantityFromName(name);
  const availability = (item?.availability || "").toLowerCase();
  const available = /Skladem/i.test(fullText)
    ? !/není\s+skladem/i.test(fullText)
    : availability.startsWith("available");

  return {
    retailerId: "rossmann",
    externalId: sku,
    sourceUrl,
    name,
    brand: item?.item_brand?.trim() || null,
    sku,
    gtin,
    quantityValue: pack.value,
    quantityUnit: pack.unit,
    imageUrl: metaContent(html, "og:image"),
    category: item?.item_category?.trim() || null,
    countryOfOrigin: null,
    metadata: {
      parser: "rossmann-html-v1",
      availability: item?.availability ?? null,
    },
    offer: {
      price,
      regularPrice: price,
      loyaltyPrice: null,
      unitPrice: unitHit ? decimal(unitHit[1]) : null,
      unitBasis: unitHit ? unitHit[2].replace(/\s+/g, " ") : null,
      currency: "CZK",
      available,
    },
  };
}

export const rossmannAdapter: CatalogAdapter = {
  retailer: "rossmann",
  hostPattern: /^(?:www\.)?rossmann\.cz$/i,
  robotsUrl: ROSSMANN_ROBOTS_URL,
  sitemapUrl: ROSSMANN_SITEMAP_URL,
  robotsMustAllowPath: "/pamlsky-frolic-twistos-s-hovezim-2",
  robotsDeniedMessage: "Rossmann robots.txt currently disallows public product crawling",
  productPath: PRODUCT_PATH,
  preferSitemapName: /sitemap-products/i,
  parse: parseRossmannProductPage,
  externalIdFromUrl: () => null,
};
