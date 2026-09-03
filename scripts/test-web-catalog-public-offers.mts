import assert from "node:assert/strict";
import { mapCatalogOfferRow } from "../lib/setrik/map-catalog-offer.ts";

const mapped = mapCatalogOfferRow({
  retailer_product_id: "product-1",
  retailer_id: "billa",
  price: "19.90",
  regular_price: 29.9,
  loyalty_price: null,
  unit_price: "39.8",
  unit_basis: "kg",
  currency: "CZK",
  source_url: "https://www.billa.cz/produkt/test",
  observed_at: "2026-09-03T10:00:00.000Z",
  retailer_products: {
    id: "product-1",
    name: "Testovací produkt",
    brand: "Test",
    image_url: "https://example.com/product.jpg",
    category: "Potraviny",
    quantity_value: 500,
    quantity_unit: "g",
  },
});

assert.equal(mapped.id, "product-1");
assert.equal(mapped.name, "Testovací produkt");
assert.equal(mapped.store, "billa");
assert.equal(mapped.price, 19.9);
assert.equal(mapped.regular_price, 29.9);
assert.equal(mapped.unit, "39,8 Kč/kg");
assert.equal(mapped.product_url, "https://www.billa.cz/produkt/test");
assert.equal(mapped.source, "web_catalog");
assert.equal(mapped.valid_from, null);
assert.equal(mapped.valid_to, null);

const arrayRelation = mapCatalogOfferRow({
  retailer_product_id: "product-2",
  retailer_id: "dm",
  price: 49,
  currency: "CZK",
  retailer_products: [{ name: "Druhý produkt", quantity_value: 250, quantity_unit: "ml" }],
});

assert.equal(arrayRelation.name, "Druhý produkt");
assert.equal(arrayRelation.unit, "250 ml");

console.log("web catalog public offers mapping: OK");
