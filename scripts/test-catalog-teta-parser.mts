import assert from "node:assert/strict";
import { parseTetaProductPage, splitTetaSitemap } from "../lib/catalog-collector/teta.ts";

{
  const index = `<?xml version="1.0"?><sitemapindex>
    <sitemap><loc>https://www.tetadrogerie.cz/products-1.xml</loc></sitemap>
    <sitemap><loc>https://example.com/foreign.xml</loc></sitemap>
  </sitemapindex>`;
  const parsed = splitTetaSitemap(index);
  assert.deepEqual(parsed.childSitemaps, ["https://www.tetadrogerie.cz/products-1.xml"]);
}

{
  const urlset = `<?xml version="1.0"?><urlset>
    <url><loc>https://www.tetadrogerie.cz/eshop/katalog/zewa-toal-papir-%288ks-fol%29-3vr-deluxe</loc></url>
    <url><loc>https://www.tetadrogerie.cz/eshop/produkty/vse</loc></url>
  </urlset>`;
  const parsed = splitTetaSitemap(urlset);
  assert.equal(parsed.productUrls.length, 1);
  assert.match(parsed.productUrls[0], /\/eshop\/katalog\/zewa/);
}

{
  const html = `<!doctype html><html><head>
    <meta property="og:image" content="https://cdn.example.test/zewa.jpg">
  </head><body>
    <div>Zewa</div>
    <h1>Zewa Deluxe Delicate Care toaletní papír 3vrstvý 8 ks</h1>
    <div>59,90 Kč</div>
    <div>49,90 Kč</div>
    <div>-16 %</div>
    <div>0,32 Kč/M</div>
    <div>Dostupné online</div>
    <div>Kód: 151261</div>
    <section><div>Země původu</div><div>Rakousko</div><div>Značka</div><div>Zewa</div></section>
  </body></html>`;
  const product = parseTetaProductPage(
    html,
    "https://www.tetadrogerie.cz/eshop/katalog/zewa-toal-papir-(8ks-fol)-3vr-deluxe"
  );
  assert.equal(product.retailerId, "teta");
  assert.equal(product.externalId, "151261");
  assert.equal(product.name, "Zewa Deluxe Delicate Care toaletní papír 3vrstvý 8 ks");
  assert.equal(product.brand, "Zewa");
  assert.equal(product.quantityValue, 8);
  assert.equal(product.quantityUnit, "kus");
  assert.equal(product.countryOfOrigin, "Rakousko");
  assert.equal(product.offer.regularPrice, 59.9);
  assert.equal(product.offer.price, 49.9);
  assert.equal(product.offer.unitPrice, 0.32);
  assert.equal(product.offer.unitBasis, "M");
  assert.equal(product.offer.available, true);
}

{
  const html = `<html><body>
    <div>Tip Line</div>
    <h1>Tip Line kosmetické kapesníky 2vrstvé 100 ks</h1>
    <div>17,90 Kč</div><div>0,18 Kč/KS</div><div>Dostupné online</div><div>Kód: 196442</div>
    <div>Značka</div><div>Tip Line</div>
  </body></html>`;
  const product = parseTetaProductPage(html, "https://www.tetadrogerie.cz/eshop/katalog/tip-line-test");
  assert.equal(product.externalId, "196442");
  assert.equal(product.offer.price, 17.9);
  assert.equal(product.offer.regularPrice, 17.9);
  assert.equal(product.offer.unitPrice, 0.18);
  assert.equal(product.quantityValue, 100);
  assert.equal(product.quantityUnit, "kus");
}

console.log("OK: Teta catalog collector parser tests passed");
