import assert from "node:assert/strict";
import { extractAllViewerCandidates } from "../lib/leaflet-monitor/viewer-candidates.ts";

const blocks = Array.from({ length: 15 }, (_, index) => {
  const n = index + 1;
  const price = `${20 + n},90`;
  return `Produkt ${n} testovací balení ${price}`;
});
const result = extractAllViewerCandidates(blocks.join(" | "), 7);
assert.equal(result.length, 15, "all 15 visible price/product blocks must become candidates");
assert.equal(new Set(result.map((row) => row.candidate_key)).size, 15);
assert.ok(result.every((row) => row.page_no === 7));
const wholeCrown = extractAllViewerCandidates("Jogurt bílý 9,-", 2);
assert.equal(wholeCrown.length, 1);
assert.equal(wholeCrown[0]?.price_sale, 9);
const uncertain = extractAllViewerCandidates("Cena za 1 kg 99,90", 3);
assert.equal(uncertain.length, 1, "uncertain anchors must not be silently dropped");
assert.equal(uncertain[0]?.status, "quarantine");
console.log("PASS viewer completeness: all 15 product anchors captured; 9,- captured; uncertain anchor quarantined");
