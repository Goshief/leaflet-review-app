import { metaContent, tagText } from "./html.ts";
import type { CatalogAdapter } from "./generic-runner.ts";
import {
  jsonLdBrand,
  jsonLdGtin,
  jsonLdImage,
  jsonLdOffer,
  jsonLdProducts,
  jsonLdText,
  quantityFromName,
} from "./parse.ts";
import { splitRetailerSitemap } from "./sitemap.ts";
import type { CatalogProduct } from "./types.ts";

export const ROHLIK_BASE_URL = "https://www.rohlik.cz";
export const ROHLIK_ROBOTS_URL = `${ROHLIK_BASE_URL}/robots.txt`;
export const ROHLIK_SITEMAP_URL = `${ROHLIK_BASE_URL}/sitemap.xml`;

const PRODUCT_PATH = /^\/\d{4,}-[^/]*$/i;
const PRODUCT_URL_ID = /^\/(\d{4,})-/;

export function splitRohlikSitemap(xml: string) {
  return splitRetailerSitemap(xml, rohlikAdapter);
}

export function rohlikExternalIdFromUrl(sourceUrl: string) {
  try {
    return new URL(sourceUrl).pathname.match(PRODUCT_URL_ID)?.[1] ?? null;
  } catch {
    return null;
  }
}

function brandFromName(name: string) {
  const first = name.split(/\s+/)[0] ?? "";
  if (first.length >= 2 && first.length <= 40 && /^[\p{L}\p{N}.&+-]+$/u.test(first)) return first;
  return null;
}

export function parseRohlikProductPage(html: string, sourceUrl: string): CatalogProduct {
  const product = jsonLdProducts(html)[0];
  const name = jsonLdText(product?.name) ?? tagText(html, "h1");
  if (!name) throw new Error("Rohlik product page: missing product name");

  const sku = jsonLdText(product?.sku) ?? rohlikExternalIdFromUrl(sourceUrl);
  if (!sku) throw new Error("Rohlik product page: missing product id");

  const offer = jsonLdOffer(product ?? {});
  if (offer.price == null) throw new Error("Rohlik product page: missing public price");

  const pack = quantityFromName(name);
  const brand = jsonLdBrand(product?.brand) ?? brandFromName(name);

  return {
    retailerId: "rohlik",
    externalId: sku,
    sourceUrl,
    name,
    brand,
    sku,
    gtin: jsonLdGtin(product ?? {}),
    quantityValue: pack.value,
    quantityUnit: pack.unit,
    imageUrl: jsonLdImage(product?.image) ?? metaContent(html, "og:image"),
    category: jsonLdText(product?.category),
    countryOfOrigin: null,
    metadata: {
      parser: "rohlik-jsonld-v1",
    },
    offer: {
      price: offer.price,
      regularPrice: offer.price,
      loyaltyPrice: null,
      unitPrice: null,
      unitBasis: null,
      currency: offer.currency,
      available: offer.available,
    },
  };
}

export const rohlikAdapter: CatalogAdapter = {
  retailer: "rohlik",
  hostPattern: /^(?:www\.)?rohlik\.cz$/i,
  robotsUrl: ROHLIK_ROBOTS_URL,
  sitemapUrl: ROHLIK_SITEMAP_URL,
  robotsMustAllowPath: "/1296729-nivea-men-black-white-invisible-original-sprej-antiperspirant",
  robotsDeniedMessage: "Rohlik robots.txt currently disallows public product crawling",
  productPath: PRODUCT_PATH,
  preferSitemapName: /sitemap_products/i,
  parse: parseRohlikProductPage,
  externalIdFromUrl: rohlikExternalIdFromUrl,
};
