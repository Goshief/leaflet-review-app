import assert from "node:assert/strict";
import { dmExternalIdFromUrl, parseDmProductPage, splitDmSitemap } from "../lib/catalog-collector/dm.ts";

{
  const index = `<?xml version="1.0"?><sitemapindex>
    <sitemap><loc>https://www.dm.cz/sitemap-products.xml</loc></sitemap>
    <sitemap><loc>https://example.com/foreign.xml</loc></sitemap>
  </sitemapindex>`;
  const parsed = splitDmSitemap(index);
  assert.deepEqual(parsed.childSitemaps, ["https://www.dm.cz/sitemap-products.xml"]);
}

{
  const urlset = `<?xml version="1.0"?><urlset>
    <url><loc>https://www.dm.cz/p/d/1458699/denkmit-univerzalni-cistic-koncentrat</loc></url>
    <url><loc>https://www.dm.cz/domacnost</loc></url>
  </urlset>`;
  const parsed = splitDmSitemap(urlset);
  assert.deepEqual(parsed.productUrls, ["https://www.dm.cz/p/d/1458699/denkmit-univerzalni-cistic-koncentrat"]);
  assert.equal(dmExternalIdFromUrl(parsed.productUrls[0]), "1458699");
}

{
  const html = `<!doctype html><html><head>
    <meta property="og:image" content="https://products.dm-static.com/example.jpg">
  </head><body>
    <h1><a href="/znacky/denkmit">Denkmit</a> univerzální čistič koncentrát, 100 ml</h1>
    <div>Aktuální cena:18,50 Kč | <del>Původní cena:37,50 Kč</del></div>
    <div>100 ml (18,50 Kč za 100 ml)vč. DPH plus poštovné</div>
    <div>Momentálně není skladem</div>
    <h2>Informace o produktu</h2>
    <div>číslo produktu dm: 1458699</div>
    <div>GTIN: 4066447792355</div>
    <h3>Vyrobeno v</h3><div>Dánsko</div>
  </body></html>`;
  const product = parseDmProductPage(
    html,
    "https://www.dm.cz/p/d/1458699/denkmit-univerzalni-cistic-koncentrat"
  );
  assert.equal(product.retailerId, "dm");
  assert.equal(product.externalId, "1458699");
  assert.equal(product.sku, "1458699");
  assert.equal(product.gtin, "4066447792355");
  assert.equal(product.brand, "Denkmit");
  assert.equal(product.name, "Denkmit univerzální čistič koncentrát, 100 ml");
  assert.equal(product.quantityValue, 100);
  assert.equal(product.quantityUnit, "ml");
  assert.equal(product.offer.price, 18.5);
  assert.equal(product.offer.regularPrice, 37.5);
  assert.equal(product.offer.unitPrice, 18.5);
  assert.equal(product.offer.unitBasis, "100 ml");
  assert.equal(product.offer.available, false);
  assert.equal(product.countryOfOrigin, "Dánsko");
  assert.equal(product.imageUrl, "https://products.dm-static.com/example.jpg");
}

{
  const html = `<html><body>
    <h1><a>Denkmit</a> univerzální čistič Limetka, 1 l</h1>
    <div>Aktuální cena:32,50 Kč</div>
    <div>1 000 ml (3,25 Kč za 100 ml)</div>
    <div>Skladem</div>
    <div>číslo produktu dm: 1234567</div>
    <div>GTIN: 4066447000000</div>
  </body></html>`;
  const product = parseDmProductPage(html, "https://www.dm.cz/p/d/1234567/test");
  assert.equal(product.offer.price, 32.5);
  assert.equal(product.offer.regularPrice, 32.5);
  assert.equal(product.offer.unitPrice, 3.25);
  assert.equal(product.offer.unitBasis, "100 ml");
  assert.equal(product.offer.available, true);
  assert.equal(product.quantityValue, 1000);
  assert.equal(product.quantityUnit, "ml");
}

console.log("OK: dm catalog collector parser tests passed");
