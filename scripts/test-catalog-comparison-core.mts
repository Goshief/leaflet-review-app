import assert from "node:assert/strict";
import {
  canonicalKey,
  normalizeCatalogText,
  normalizeQuantity,
  scoreProductIdentity,
} from "../lib/catalog-core/matcher.ts";
import { optimizeSmartCart } from "../lib/catalog-core/smart-cart-optimizer.ts";

assert.equal(normalizeCatalogText("Čerstvé MLÉKO 1,5 %"), "cerstve mleko 1 5");
assert.deepEqual(normalizeQuantity(1, "l"), { value: 1000, unit: "ml" });
assert.deepEqual(normalizeQuantity("0.5", "kg"), { value: 500, unit: "g" });

const ajaxA = {
  name: "Ajax Floral Fiesta Spring Flowers 1 l",
  brand: "Ajax",
  quantity_value: 1,
  quantity_unit: "l",
  category: "Drogerie",
};
const ajaxB = {
  name: "AJAX Floral Fiesta Spring Flowers 1000 ml",
  brand: "AJAX",
  quantity_value: 1000,
  quantity_unit: "ml",
  category: "Drogerie",
};
const ajaxScore = scoreProductIdentity(ajaxA, ajaxB);
assert.ok(ajaxScore.total >= 0.9, `expected high Ajax match, got ${ajaxScore.total}`);

const wrongBrand = scoreProductIdentity(ajaxA, { ...ajaxB, brand: "OtherBrand" });
assert.ok(wrongBrand.total <= 0.55, `brand conflict must cap score, got ${wrongBrand.total}`);
const wrongPack = scoreProductIdentity(ajaxA, { ...ajaxB, quantity_value: 5, quantity_unit: "l" });
assert.ok(wrongPack.total <= 0.6, `quantity conflict must cap score, got ${wrongPack.total}`);
assert.equal(canonicalKey(ajaxA).length, 64);

const items = [
  { canonicalProductId: "a", quantity: 1 },
  { canonicalProductId: "b", quantity: 1 },
];
const offers = [
  { canonicalProductId: "a", retailer: "lidl", price: 20 },
  { canonicalProductId: "b", retailer: "lidl", price: 40 },
  { canonicalProductId: "a", retailer: "tesco", price: 15 },
  { canonicalProductId: "b", retailer: "tesco", price: 50 },
  { canonicalProductId: "a", retailer: "billa", price: 18 },
  { canonicalProductId: "b", retailer: "billa", price: 35 },
];

const oneStore = optimizeSmartCart(items, offers, { maxStores: 1 });
assert.equal(oneStore.ok, true);
assert.equal(oneStore.total, 53);
assert.deepEqual(oneStore.stores, ["billa"]);

const twoStores = optimizeSmartCart(items, offers, { maxStores: 2 });
assert.equal(twoStores.ok, true);
assert.equal(twoStores.total, 50);
assert.deepEqual(new Set(twoStores.stores), new Set(["billa", "tesco"]));

const loyalty = optimizeSmartCart(
  [{ canonicalProductId: "a", quantity: 2 }],
  [{ canonicalProductId: "a", retailer: "billa", price: 20, loyaltyPrice: 12 }],
  { maxStores: 1, includeLoyaltyPrices: true }
);
assert.equal(loyalty.total, 24);

console.log("OK: catalog comparison core tests passed");
