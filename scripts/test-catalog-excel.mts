import assert from "node:assert/strict";
import {
  PRICE_OBSERVATION_COLUMNS,
  RETAILER_OFFER_COLUMNS,
  RETAILER_PRODUCT_COLUMNS,
  catalogImportTables,
  catalogProductsToCsvFiles,
  catalogProductsToXlsx,
} from "../lib/catalog-collector/excel.ts";
import { isSafeSnapshotName } from "../lib/catalog-collector/snapshot.ts";
import type { CatalogProduct, CatalogRunStats } from "../lib/catalog-collector/types.ts";

const product: CatalogProduct = {
  retailerId: "lidl",
  externalId: "10000794",
  sourceUrl: "https://www.lidl.cz/p/zlaty-bazant/p10000794",
  name: "ZLATÝ BAŽANT",
  brand: "Zlatý Bažant",
  sku: "10000794",
  gtin: "8585000940012",
  quantityValue: 500,
  quantityUnit: "ml",
  imageUrl: "https://example.test/bazant.png",
  category: "Pivo",
  countryOfOrigin: null,
  metadata: {},
  offer: {
    price: 10.9,
    regularPrice: 12.9,
    loyaltyPrice: null,
    unitPrice: 21.8,
    unitBasis: "1 l",
    currency: "CZK",
    available: true,
  },
};

const stats: CatalogRunStats = {
  retailer: "lidl",
  discovered: 10,
  attempted: 1,
  saved: 1,
  failed: 0,
  unchangedRaw: 0,
  startedAt: "2026-08-30T12:00:00.000Z",
  finishedAt: "2026-08-30T12:00:01.000Z",
  errors: [],
};

const xlsx = catalogProductsToXlsx({ products: [product], stats, collectedAt: stats.finishedAt });
assert.equal(xlsx.subarray(0, 2).toString("utf8"), "PK");
assert.ok(xlsx.includes(Buffer.from("ZLATÝ BAŽANT")));
assert.ok(xlsx.includes(Buffer.from("retailer_products")));
assert.ok(xlsx.includes(Buffer.from("retailer_offers_current")));
assert.ok(xlsx.includes(Buffer.from("offer_fingerprint")));
assert.ok(xlsx.includes(Buffer.from("observed_on")));

const tables = catalogImportTables([product], stats.finishedAt);
assert.equal(tables.retailer_products.headers.join(";"), RETAILER_PRODUCT_COLUMNS.join(";"));
assert.equal(tables.retailer_offers_current.headers.join(";"), RETAILER_OFFER_COLUMNS.join(";"));
assert.equal(tables.retailer_price_observations.headers.join(";"), PRICE_OBSERVATION_COLUMNS.join(";"));
assert.equal(tables.retailer_products.rows.length, 1);
assert.equal(tables.retailer_products.rows[0]?.[1], "lidl");
assert.equal(tables.retailer_products.rows[0]?.[2], "10000794");
assert.equal(tables.retailer_products.rows[0]?.[4], "ZLATÝ BAŽANT");
assert.equal(tables.retailer_offers_current.rows[0]?.[7], "CZK");
assert.equal(tables.retailer_offers_current.rows[0]?.[8], true);
assert.equal(String(tables.retailer_offers_current.rows[0]?.[10]).length, 64);
assert.equal(tables.retailer_price_observations.rows[0]?.[3], "2026-08-30");
assert.equal(tables.retailer_products.rows[0]?.[0], tables.retailer_offers_current.rows[0]?.[0]);

const csvFiles = catalogProductsToCsvFiles([product], stats.finishedAt);
assert.match(csvFiles["retailer_products.csv"], /external_id/);
assert.match(csvFiles["retailer_products.csv"], /10000794/);
assert.match(csvFiles["retailer_offers_current.csv"], /offer_fingerprint/);
assert.equal(csvFiles["retailer_products.csv"].charCodeAt(0), 0xfeff);

assert.equal(isSafeSnapshotName("catalog-all-latest.xlsx"), true);
assert.equal(isSafeSnapshotName("catalog-lidl-latest.xlsx"), true);
assert.equal(isSafeSnapshotName("../secret.xlsx"), false);
assert.equal(isSafeSnapshotName("catalog-lidl-latest.csv"), false);

console.log("OK: catalog excel export tests passed");
