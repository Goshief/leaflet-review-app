/**
 * Zlatý JSON BILLA strana 1 (5.–11. 8. 2026) = 21polový staging kontrakt.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLidlPageOffersJson, LIDL_PAGE_OFFER_KEYS } from "../lib/lidl-parser/lidl-page-offer.ts";
import {
  parseBillaRawBlock,
  parseLeafletHeaderDates,
  type BillaStagingContext,
} from "../lib/leaflet/billa-staging.ts";
import { leafletOffersToCsv, leafletOffersToJson, pickStagingFields } from "../lib/leaflet/offers-csv.ts";

const goldPath = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "billa-page1-gold.json");
const goldText = readFileSync(goldPath, "utf8");
const parsed = parseLidlPageOffersJson(goldText);
assert(parsed.ok, `gold JSON musí projít kontrakt: ${!parsed.ok && "errors" in parsed ? parsed.errors.join("; ") : ""}`);
assert.equal(parsed.ok && parsed.offers.length, 17);

const gold = parsed.ok ? parsed.offers : [];

const csv = leafletOffersToCsv(gold);
assert.ok(csv.includes(LIDL_PAGE_OFFER_KEYS.join(";")), "Excel musí mít 21 sloupců kontraktu");
const jsonRoundtrip = parseLidlPageOffersJson(leafletOffersToJson(gold));
assert(jsonRoundtrip.ok);
assert.equal(jsonRoundtrip.ok && jsonRoundtrip.offers.length, 17);

const header = parseLeafletHeaderDates(
  "od středy 5. 8. do úterý 11. 8. 2026. 5. 8. – 11. 8. 2026"
);
assert.equal(header.valid_from, "2026-08-05");
assert.equal(header.valid_to, "2026-08-11");
assert.equal(header.valid_from_text, "od středy 5. 8.");
assert.equal(header.valid_to_text, "do úterý 11. 8. 2026.");

const ctx: BillaStagingContext = {
  store_id: "billa",
  page_no: null,
  pageText: "od středy 5. 8. do úterý 11. 8. 2026. 5. 8. – 11. 8. 2026",
  dates: header,
};

const uniqueRaws = [...new Set(gold.map((r) => r.raw_text_block).filter((x): x is string => !!x))];
const got = uniqueRaws.flatMap((raw) => parseBillaRawBlock(raw, ctx));

assert.equal(got.length, gold.length, `řádků ${got.length}, čekám ${gold.length}: ${got.map((g) => g.extracted_name).join("; ")}`);

function near(a: number | null, b: number | null) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.011;
}

function scopedRaw(raw: string | null) {
  return /SUPER\s+(STŘEDA|PÁTEK)|\bOD\s+\d{1,2}\.\s*\d{1,2}\.?\s+DO/i.test(raw ?? "");
}

for (const expected of gold) {
  const row = got.find((r) => r.extracted_name === expected.extracted_name);
  assert.ok(row, `chybí ${expected.extracted_name}; mám ${got.map((g) => g.extracted_name).join("; ")}`);
  assert.equal(row.store_id, "billa");
  assert.equal(row.source_type, "leaflet");
  assert.equal(row.currency, "CZK");
  assert.ok(near(row.price_total, expected.price_total), `${expected.extracted_name} price_total ${row.price_total} ≠ ${expected.price_total}`);
  assert.ok(near(row.price_standard, expected.price_standard), `${expected.extracted_name} price_standard ${row.price_standard} ≠ ${expected.price_standard}`);
  assert.ok(near(row.typical_price_per_unit, expected.typical_price_per_unit), `${expected.extracted_name} typical ${row.typical_price_per_unit} ≠ ${expected.typical_price_per_unit}`);
  assert.ok(near(row.price_with_loyalty_card, expected.price_with_loyalty_card), `${expected.extracted_name} loyalty ${row.price_with_loyalty_card}`);
  assert.equal(row.has_loyalty_card_price, expected.has_loyalty_card_price, expected.extracted_name);
  assert.equal(row.pack_qty, expected.pack_qty, expected.extracted_name);
  assert.equal(row.pack_unit, expected.pack_unit, expected.extracted_name);
  assert.ok(near(row.pack_unit_qty, expected.pack_unit_qty), `${expected.extracted_name} pack_unit_qty`);
  assert.equal(row.notes, expected.notes, expected.extracted_name);
  assert.equal(row.brand, expected.brand, expected.extracted_name);
  assert.equal(row.category, expected.category);
  if (scopedRaw(expected.raw_text_block) || expected.valid_from === header.valid_from) {
    assert.equal(row.valid_from, expected.valid_from, `${expected.extracted_name} valid_from`);
    assert.equal(row.valid_to, expected.valid_to, `${expected.extracted_name} valid_to`);
    assert.equal(row.valid_from_text, expected.valid_from_text, `${expected.extracted_name} valid_from_text`);
    assert.equal(row.valid_to_text, expected.valid_to_text, `${expected.extracted_name} valid_to_text`);
  }
}

const meat = parseBillaRawBlock(
  "Výrobek | z mělněného | masa | balení, 750 g | 100 g = 11,99 Kč | -25% | 89,90 | 119,90/",
  ctx
)[0];
assert.ok(meat);
assert.match(String(meat.extracted_name), /Výrobek z mělněného masa/i);
assert.equal(meat.pack_unit, "g");
assert.equal(meat.pack_unit_qty, 750);
assert.equal(meat.price_total, 89.9);
assert.equal(meat.price_standard, 119.9);

const keys = Object.keys(pickStagingFields(got[0] as unknown as Record<string, unknown>));
assert.deepEqual(keys, [...LIDL_PAGE_OFFER_KEYS]);

console.log(`OK: BILLA gold staging — ${got.length} řádků, Excel i JSON = 21 polí`);
