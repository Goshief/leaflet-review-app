import assert from "node:assert/strict";
import { parseRossmannProductPage, splitRossmannSitemap } from "../lib/catalog-collector/rossmann.ts";

{
  const index = `<?xml version="1.0"?><sitemapindex>
    <sitemap><loc>https://www.rossmann.cz/binbox/pub/sitemap/sitemap-products_0_CZ_cs-CZ.xml</loc></sitemap>
    <sitemap><loc>https://www.rossmann.cz/binbox/pub/sitemap/sitemap-stores_0_CZ_cs-CZ.xml</loc></sitemap>
  </sitemapindex>`;
  const parsed = splitRossmannSitemap(index);
  assert.deepEqual(parsed.childSitemaps, [
    "https://www.rossmann.cz/binbox/pub/sitemap/sitemap-products_0_CZ_cs-CZ.xml",
    "https://www.rossmann.cz/binbox/pub/sitemap/sitemap-stores_0_CZ_cs-CZ.xml",
  ]);
}

{
  const urlset = `<?xml version="1.0"?><urlset>
    <url><loc>https://www.rossmann.cz/pamlsky-frolic-twistos-s-hovezim-2</loc></url>
    <url><loc>https://example.com/foreign-product</loc></url>
  </urlset>`;
  const parsed = splitRossmannSitemap(urlset);
  assert.deepEqual(parsed.productUrls, ["https://www.rossmann.cz/pamlsky-frolic-twistos-s-hovezim-2"]);
}

{
  const html = `<!doctype html><html><head>
    <meta property="og:image" content="https://binbox.rossmann.cz/example.jpg">
  </head><body>
    <h1>Pamlsky Frolic Twistos s hovězím </h1>
    <script>dataLayer.push({event:"ec_detail_view",ecommerce:{items:[{item_id:"976299",item_name:"Pamlsky Frolic Twistos s hov\\u011bz\\u00edm ",item_brand:"Frolic",item_variant:"105 g",item_category:"Dom\\u00e1c\\u00ed mazl\\u00ed\\u010dci",price:"40.09",priceVAT:"44.90",availability:"available_both"}],currency:"CZK"}});</script>
    <div class="typo--h2">44.90 Kč</div>
    <div>Skladem</div>
    <div>Běžná cena: 42.76 Kč/100 g</div>
    <div>EAN<span> 05998749140291</span></div>
    <div>Obj. č.:<span> 976299</span></div>
  </body></html>`;
  const product = parseRossmannProductPage(html, "https://www.rossmann.cz/pamlsky-frolic-twistos-s-hovezim-2");
  assert.equal(product.retailerId, "rossmann");
  assert.equal(product.externalId, "976299");
  assert.equal(product.sku, "976299");
  assert.equal(product.gtin, "05998749140291");
  assert.equal(product.brand, "Frolic");
  assert.equal(product.name, "Pamlsky Frolic Twistos s hovězím");
  assert.equal(product.quantityValue, 105);
  assert.equal(product.quantityUnit, "g");
  assert.equal(product.category, "Domácí mazlíčci");
  assert.equal(product.offer.price, 44.9);
  assert.equal(product.offer.unitPrice, 42.76);
  assert.equal(product.offer.unitBasis, "100 g");
  assert.equal(product.offer.available, true);
  assert.equal(product.imageUrl, "https://binbox.rossmann.cz/example.jpg");
}

{
  const html = `<html><body>
    <h1>Tip Line kapesníky 100 ks</h1>
    <script>dataLayer.push({event:"ec_detail_view",ecommerce:{items:[{item_id:"123456",item_name:"Tip Line kapesníky 100 ks",item_brand:"Tip Line",item_variant:"100 ks",priceVAT:"17.90",availability:"unavailable"}],currency:"CZK"}});</script>
    <div>17.90 Kč</div>
    <div>EAN 8594000000001</div>
    <div>Obj. č.: 123456</div>
  </body></html>`;
  const product = parseRossmannProductPage(html, "https://www.rossmann.cz/tip-line-kapesniky");
  assert.equal(product.externalId, "123456");
  assert.equal(product.offer.price, 17.9);
  assert.equal(product.quantityValue, 100);
  assert.equal(product.quantityUnit, "kus");
  assert.equal(product.offer.available, false);
}

console.log("OK: Rossmann catalog collector parser tests passed");
