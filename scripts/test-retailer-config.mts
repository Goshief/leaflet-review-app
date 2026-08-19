import assert from "node:assert/strict";
import { RETAILERS } from "../lib/leaflet-monitor/retailers.ts";

const expected = {
  billa: "https://www.billa.cz/letaky-billa/velky-letak",
  lidl: "https://www.lidl.cz/",
  kaufland: "https://www.kaufland.cz/",
  penny: "https://www.penny.cz/nabidky/letaky",
} as const;

for (const [id, sourceUrl] of Object.entries(expected)) {
  const matches = RETAILERS.filter((retailer) => retailer.id === id);
  assert.equal(matches.length, 1, `${id}: exactly one retailer config must exist`);
  assert.equal(matches[0]?.source_url, sourceUrl, `${id}: source_url changed unexpectedly`);
  assert.equal(matches[0]?.connector, "active", `${id}: connector must remain active`);
}

assert.equal(new Set(RETAILERS.map((retailer) => retailer.id)).size, RETAILERS.length, "retailer IDs must be unique");
console.log("PASS retailer config: BILLA, Lidl, Kaufland and Penny IDs/source URLs are exact and unique");
