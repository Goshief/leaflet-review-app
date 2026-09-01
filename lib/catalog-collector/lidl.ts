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

export const LIDL_BASE_URL = "https://www.lidl.cz";
export const LIDL_ROBOTS_URL = `${LIDL_BASE_URL}/robots.txt`;
export const LIDL_SITEMAP_URL = `${LIDL_BASE_URL}/static/sitemap.xml`;

const PRODUCT_PATH = /^\/p\/[^/]+\/p\d+\/?$/i;
const PRODUCT_URL_ID = /\/p(\d+)\/?$/i;

export function splitLidlSitemap(xml: string) {
  return splitRetailerSitemap(xml, lidlAdapter);
}

export function lidlExternalIdFromUrl(sourceUrl: string) {
  try {
    return new URL(sourceUrl).pathname.match(PRODUCT_URL_ID)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function parseLidlProductPage(html: string, sourceUrl: string): CatalogProduct {
  const product = jsonLdProducts(html)[0];
  const name = jsonLdText(product?.name) ?? tagText(html, "h1");
  if (!name) throw new Error("Lidl product page: missing product name");

  const sku = jsonLdText(product?.sku) ?? lidlExternalIdFromUrl(sourceUrl);
  if (!sku) throw new Error("Lidl product page: missing product sku");

  const offer = jsonLdOffer(product ?? {});
  if (offer.price == null) throw new Error("Lidl product page: missing public price");

  const pack = quantityFromName(name);
  const brand = jsonLdBrand(product?.brand);
  const imageUrl = jsonLdImage(product?.image) ?? metaContent(html, "og:image");
  const gtin = jsonLdGtin(product ?? {});
  const category = jsonLdText(product?.category);

  return {
    retailerId: "lidl",
    externalId: sku,
    sourceUrl,
    name,
    brand,
    sku,
    gtin,
    quantityValue: pack.value,
    quantityUnit: pack.unit,
    imageUrl,
    category,
    countryOfOrigin: null,
    metadata: {
      parser: "lidl-jsonld-v1",
      jsonld_sku: jsonLdText(product?.sku),
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

export const lidlAdapter: CatalogAdapter = {
  retailer: "lidl",
  hostPattern: /^(?:www\.)?lidl\.cz$/i,
  robotsUrl: LIDL_ROBOTS_URL,
  sitemapUrl: LIDL_SITEMAP_URL,
  robotsMustAllowPath: "/p/zlaty-bazant/p10000794",
  robotsDeniedMessage: "Lidl robots.txt currently disallows public /p/ product crawling",
  productPath: PRODUCT_PATH,
  preferSitemapName: /product_sitemap|product/i,
  parse: parseLidlProductPage,
  externalIdFromUrl: lidlExternalIdFromUrl,
};
