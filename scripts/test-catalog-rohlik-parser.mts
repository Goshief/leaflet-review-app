import assert from "node:assert/strict";
import { parseRohlikProductPage, rohlikExternalIdFromUrl, splitRohlikSitemap } from "../lib/catalog-collector/rohlik.ts";

{
  const index = `<?xml version="1.0"?><sitemapindex>
    <sitemap><loc>https://www.rohlik.cz/sitemap_products.xml</loc></sitemap>
    <sitemap><loc>https://www.rohlik.cz/sitemap_brands.xml</loc></sitemap>
  </sitemapindex>`;
  const parsed = splitRohlikSitemap(index);
  assert.deepEqual(parsed.childSitemaps, [
    "https://www.rohlik.cz/sitemap_products.xml",
    "https://www.rohlik.cz/sitemap_brands.xml",
  ]);
}

{
  const urlset = `<?xml version="1.0"?><urlset>
    <url><loc>https://www.rohlik.cz/1296729-nivea-men-black-white-invisible-original-sprej-antiperspirant</loc></url>
    <url><loc>https://www.rohlik.cz/c300124206-kosmetika</loc></url>
  </urlset>`;
  const parsed = splitRohlikSitemap(urlset);
  assert.deepEqual(parsed.productUrls, [
    "https://www.rohlik.cz/1296729-nivea-men-black-white-invisible-original-sprej-antiperspirant",
  ]);
  assert.equal(rohlikExternalIdFromUrl(parsed.productUrls[0]), "1296729");
}

{
  const html = `<!doctype html><html><head>
    <meta property="og:image" content="https://cdn.rohlik.cz/nivea.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Nivea Men Black & white invisible original sprej antiperspirant 150 ml","sku":"1296729","gtin13":"4005900555821","category":"Ve spreji > Pánské","image":["https://cdn.rohlik.cz/nivea.jpg"],"offers":{"@type":"Offer","price":104.9,"priceCurrency":"CZK","availability":"https://schema.org/InStock"}}</script>
  </head><body><h1>Nivea Men Black & white invisible original sprej antiperspirant 150 ml</h1></body></html>`;
  const product = parseRohlikProductPage(
    html,
    "https://www.rohlik.cz/1296729-nivea-men-black-white-invisible-original-sprej-antiperspirant"
  );
  assert.equal(product.retailerId, "rohlik");
  assert.equal(product.externalId, "1296729");
  assert.equal(product.sku, "1296729");
  assert.equal(product.gtin, "4005900555821");
  assert.equal(product.brand, "Nivea");
  assert.equal(product.name, "Nivea Men Black & white invisible original sprej antiperspirant 150 ml");
  assert.equal(product.quantityValue, 150);
  assert.equal(product.quantityUnit, "ml");
  assert.equal(product.category, "Ve spreji > Pánské");
  assert.equal(product.offer.price, 104.9);
  assert.equal(product.offer.available, true);
  assert.equal(product.imageUrl, "https://cdn.rohlik.cz/nivea.jpg");
}

{
  const html = `<html><head>
    <script type="application/ld+json">{"@type":"Product","name":"Racio chlebíčky rýžové","sku":"1296965","offers":{"@type":"Offer","price":"19,90","priceCurrency":"CZK","availability":"https://schema.org/OutOfStock"}}</script>
  </head><body><h1>Racio chlebíčky rýžové</h1></body></html>`;
  const product = parseRohlikProductPage(html, "https://www.rohlik.cz/1296965-racio-chlebicky-ryzove");
  assert.equal(product.externalId, "1296965");
  assert.equal(product.offer.price, 19.9);
  assert.equal(product.offer.available, false);
  assert.equal(product.brand, "Racio");
}

console.log("OK: Rohlik catalog collector parser tests passed");
