/**
 * Smoke test: Lidl JSON parser (spouští se z npm run verify).
 */
import assert from "node:assert/strict";
import {
  parseLidlPageOffersJson,
  stripJsonArrayFromModelOutput,
} from "../lib/lidl-parser/lidl-page-offer.ts";
import { getMockLidlPageOffers } from "../lib/lidl-parser/mock-extraction.ts";

const fenced = `Here is JSON:
\`\`\`json
[{"store_id":"lidl","source_type":"leaflet","currency":"CZK","page_no":1}]
\`\`\``;

const stripped = stripJsonArrayFromModelOutput(fenced);
assert(stripped.includes("store_id"), "stripJsonArrayFromModelOutput má najít pole");

const parsed = parseLidlPageOffersJson(stripped, { fillMissingNullKeys: true });
assert(parsed.ok, `parse musí projít: ${!parsed.ok && "errors" in parsed ? parsed.errors.join("; ") : ""}`);
if (parsed.ok) {
  assert.equal(parsed.offers.length, 1);
  assert.equal(parsed.offers[0].store_id, "lidl");
  assert.equal(parsed.offers[0].currency, "CZK");
  assert.equal(parsed.offers[0].page_no, 1);
}

const bad = parseLidlPageOffersJson(`[{"store_id":"wrong"}]`, {
  fillMissingNullKeys: true,
});
assert(!bad.ok, "neplatný store_id musí selhat");

assert.equal(getMockLidlPageOffers(1).length, 8, "mock extrakce má 8 ukázkových řádků");

console.log("verify-parser: OK");
