import assert from "node:assert/strict";
import { extractAllViewerCandidates } from "../lib/leaflet-monitor/viewer-candidates.ts";

const blocks = Array.from({ length: 15 }, (_, index) => {
  const n = index + 1;
  const price = `${20 + n},90`;
  return `Produkt ${n} testovací balení ${price}`;
});
const text = blocks.join(" | ");
const result = extractAllViewerCandidates(text, 7);

assert.equal(result.length, 15, "all 15 visible price/product blocks must become candidates");
assert.equal(new Set(result.map((row) => row.candidate_key)).size, 15, "every block must have a distinct candidate key");
assert.deepEqual(result.map((row) => row.price_sale), Array.from({ length: 15 }, (_, index) => 21.9 + index));
assert.ok(result.every((row) => row.page_no === 7), "all candidates must stay isolated on the requested page");

const uncertain = extractAllViewerCandidates("Cena za 1 kg 99,90", 3);
assert.equal(uncertain.length, 1, "uncertain price anchors must not be silently dropped");
assert.equal(uncertain[0]?.status, "quarantine", "uncertain price anchor must be reviewable in quarantine");

console.log("PASS viewer candidate completeness: all 15 anchors captured; uncertain anchors quarantined, never silently dropped");
