import assert from "node:assert/strict";
import {
  parseBillaProductPage,
  robotsAllowsPath,
  splitBillaSitemap,
} from "../lib/catalog-collector/billa.ts";

{
  const sitemap = `<?xml version="1.0"?><urlset>
    <url><loc>https://www.billa.cz/produkt/billa-camembert-120g-82372016</loc></url>
    <url><loc>https://www.billa.cz/akcni-letaky</loc></url>
    <url><loc>https://example.com/produkt/cizi-123456</loc></url>
  </urlset>`;
  const parsed = splitBillaSitemap(sitemap);
  assert.deepEqual(parsed.productUrls, ["https://www.billa.cz/produkt/billa-camembert-120g-82372016"]);
  assert.deepEqual(parsed.childSitemaps, []);
}

{
  const index = `<?xml version="1.0"?><sitemapindex>
    <sitemap><loc>https://www.billa.cz/sitemap-products.xml</loc></sitemap>
    <sitemap><loc>https://www.billa.cz/sitemap-pages.xml</loc></sitemap>
  </sitemapindex>`;
  const parsed = splitBillaSitemap(index);
  assert.equal(parsed.productUrls.length, 0);
  assert.equal(parsed.childSitemaps.length, 2);
}

{
  const robots = `User-agent: *\nDisallow: /interni/\nAllow: /produkt/\n`;
  assert.equal(robotsAllowsPath(robots, "/produkt/billa-camembert-120g-82372016"), true);
  assert.equal(robotsAllowsPath(robots, "/interni/test"), false);
}

{
  const html = `<!doctype html>
  <html><head><meta property="og:image" content="https://images.example.test/camembert.jpg"></head>
  <body>
    <h1>BILLA Camembert 120g</h1>
    <div>BILLA</div>
    <div>120 g</div>
    <div>Běžná cena</div><div>29,90 Kč</div>
    <div>1 kg 249,17 Kč</div>
    <div>S BILLA klub účtem</div><div>19,90 Kč</div>
    <div>O produktu</div>
    <div>Artiklové č.: 82-372016</div>
    <div>Země původu</div><div>Česká republika</div>
  </body></html>`;
  const product = parseBillaProductPage(html, "https://www.billa.cz/produkt/billa-camembert-120g-82372016");
  assert.equal(product.externalId, "82372016");
  assert.equal(product.name, "BILLA Camembert 120g");
  assert.equal(product.brand, "BILLA");
  assert.equal(product.quantityValue, 120);
  assert.equal(product.quantityUnit, "g");
  assert.equal(product.offer.price, 29.9);
  assert.equal(product.offer.regularPrice, 29.9);
  assert.equal(product.offer.loyaltyPrice, 19.9);
  assert.equal(product.offer.unitPrice, 249.17);
  assert.equal(product.offer.unitBasis, "1 kg");
  assert.equal(product.countryOfOrigin, "Česká republika");
  assert.equal(product.imageUrl, "https://images.example.test/camembert.jpg");
}

{
  const html = `<!doctype html><html><body>
    <h1>Meloun vodní se sníženým obsahem semen</h1>
    <div>Meloun</div><div>1 kus</div><div>cca 5 kg</div>
    <div>cca 114,50 Kč</div><div>1 kg 22,90 Kč</div>
    <div>O produktu</div><div>Artiklové č.: 82-246074</div>
    <div>Země původu</div><div>Brazílie</div>
  </body></html>`;
  const product = parseBillaProductPage(html, "https://www.billa.cz/produkt/meloun-82246074");
  assert.equal(product.externalId, "82246074");
  assert.equal(product.offer.price, 114.5);
  assert.equal(product.offer.unitPrice, 22.9);
  assert.equal(product.countryOfOrigin, "Brazílie");
}

console.log("OK: BILLA catalog collector parser tests passed");
