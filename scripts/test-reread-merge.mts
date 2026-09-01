import assert from "node:assert/strict";
import {
  manualEditedKeys,
  mergeRereadKeepingManualEdits,
} from "../lib/leaflet-review/reread-merge.ts";

{
  assert.deepEqual(manualEditedKeys(null), []);
  assert.deepEqual(manualEditedKeys({}), []);
  assert.deepEqual(manualEditedKeys({ manual_edit: { fields: ["status", "product_name", "brand"] } }), [
    "product_name",
    "brand",
  ]);
}

{
  const chosen = {
    product_name: "AI název",
    brand: "AI brand",
    price_sale: 12.9,
    source_text: "fresh source",
    status: "quarantine",
    field_evidence: { product_name: { raw_text: "AI název" } },
  };
  const existing = {
    product_name: "Ruční tvaroh",
    brand: "TEST BRAND",
    price_sale: 18.9,
    field_evidence: {
      manual_edit: { at: "2026-09-01T12:00:00.000Z", fields: ["product_name", "brand", "updated_at"] },
    },
  };
  const merged = mergeRereadKeepingManualEdits(chosen, existing);
  assert.equal(merged.product_name, "Ruční tvaroh");
  assert.equal(merged.brand, "TEST BRAND");
  assert.equal(merged.price_sale, 12.9);
  assert.equal(merged.source_text, "fresh source");
  assert.equal(merged.status, "unreviewed");
  assert.equal((merged.field_evidence as { manual_edit?: { fields?: string[] } }).manual_edit?.fields?.[0], "product_name");
}

{
  const chosen = { product_name: "AI", status: "unreviewed", field_evidence: {} };
  const untouched = mergeRereadKeepingManualEdits(chosen, { product_name: "Old" });
  assert.equal(untouched.product_name, "AI");
}

console.log("OK: reread merge preserves human-edited fields");
