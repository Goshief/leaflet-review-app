import assert from "node:assert/strict";
import { lidlExternalIdFromUrl, parseLidlProductPage, splitLidlSitemap } from "../lib/catalog-collector/lidl.ts";

{
  const index = `<?xml version="1.0"?><sitemapindex>
    <sitemap><loc>https://www.lidl.cz/p/export/CZ/cs/product_sitemap.xml.gz</loc></sitemap>
    <sitemap><loc>https://www.lidl.cz/explore/assets/s/pages_cs-CZ_cz.xml.gz</loc></sitemap>
    <sitemap><loc>https://example.com/product_sitemap.xml.gz</loc></sitemap>
  </sitemapindex>`;
  const parsed = splitLidlSitemap(index);
  assert.deepEqual(parsed.childSitemaps, [
    "https://www.lidl.cz/p/export/CZ/cs/product_sitemap.xml.gz",
    "https://www.lidl.cz/explore/assets/s/pages_cs-CZ_cz.xml.gz",
  ]);
}

{
  const urlset = `<?xml version="1.0"?><urlset>
    <url><loc>https://www.lidl.cz/p/zlaty-bazant/p10000794</loc></url>
    <url><loc>https://www.lidl.cz/c/akcni-letak/s10008644</loc></url>
  </urlset>`;
  const parsed = splitLidlSitemap(urlset);
  assert.deepEqual(parsed.productUrls, ["https://www.lidl.cz/p/zlaty-bazant/p10000794"]);
  assert.equal(lidlExternalIdFromUrl(parsed.productUrls[0]), "10000794");
}

{
  const html = `<!doctype html><html><head>
    <meta property="og:image" content="https://img.example.test/bazant.png">
    <script type="application/ld+json">{"@context":"http://schema.org","@type":"Product","sku":"10000794","name":"ZLATÝ BAŽANT 500 ml","image":["https://img.example.test/bazant.png"],"brand":{"@type":"Brand","name":"Zlatý Bažant"},"gtin13":"8585000940012","offers":[{"@type":"Offer","price":10.9,"priceCurrency":"CZK","availability":"OutOfStock"}]}</script>
  </head><body><h1>ZLATÝ BAŽANT 500 ml</h1></body></html>`;
  const product = parseLidlProductPage(html, "https://www.lidl.cz/p/zlaty-bazant/p10000794");
  assert.equal(product.retailerId, "lidl");
  assert.equal(product.externalId, "10000794");
  assert.equal(product.sku, "10000794");
  assert.equal(product.gtin, "8585000940012");
  assert.equal(product.brand, "Zlatý Bažant");
  assert.equal(product.name, "ZLATÝ BAŽANT 500 ml");
  assert.equal(product.quantityValue, 500);
  assert.equal(product.quantityUnit, "ml");
  assert.equal(product.offer.price, 10.9);
  assert.equal(product.offer.regularPrice, 10.9);
  assert.equal(product.offer.available, false);
  assert.equal(product.imageUrl, "https://img.example.test/bazant.png");
}

{
  const html = `<html><head>
    <script type="application/ld+json">{"@type":"Product","sku":"10000992","name":"VELKOPOPOVICKÝ KOZEL 10","offers":{"@type":"Offer","price":"12,90","priceCurrency":"CZK","availability":"https://schema.org/InStock"}}</script>
  </head><body><h1>VELKOPOPOVICKÝ KOZEL 10</h1></body></html>`;
  const product = parseLidlProductPage(html, "https://www.lidl.cz/p/velkopopovicky-kozel-10/p10000992");
  assert.equal(product.offer.price, 12.9);
  assert.equal(product.offer.available, true);
  assert.equal(product.externalId, "10000992");
}

console.log("OK: Lidl catalog collector parser tests passed");
