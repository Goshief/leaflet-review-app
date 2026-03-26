import assert from "node:assert/strict";
import {
  EDITABLE_BATCH_ITEM_FIELDS,
  isBatchItemTable,
  sanitizeBatchItemPatch,
} from "../lib/batches/item-update.ts";
import { parsePatchBody } from "../lib/batches/item-update-route-logic.ts";

assert.equal(isBatchItemTable("offers_raw"), true);
assert.equal(isBatchItemTable("offers_quarantine"), true);
assert.equal(isBatchItemTable("offers_staging"), false);
assert.equal(EDITABLE_BATCH_ITEM_FIELDS.includes("brand"), true);
assert.equal(EDITABLE_BATCH_ITEM_FIELDS.includes("valid_to"), true);
assert.equal(EDITABLE_BATCH_ITEM_FIELDS.includes("updated_at" as never), false);

{
  const patch = sanitizeBatchItemPatch({
    extracted_name: "  Mleko  ",
    price_total: "29.90",
    has_loyalty_card_price: false,
    valid_from: "2026-03-01",
    valid_to: "",
    notes: "  ",
  });
  assert.equal(patch.extracted_name, "Mleko");
  assert.equal(patch.price_total, 29.9);
  assert.equal(patch.has_loyalty_card_price, false);
  assert.equal(patch.valid_from, "2026-03-01");
  assert.equal(patch.valid_to, null);
  assert.equal(patch.notes, null);
}

{
  const patch = sanitizeBatchItemPatch({
    extracted_name: "A",
    dangerous_field: "should_be_ignored",
  } as unknown as Record<string, unknown>);
  assert.equal("dangerous_field" in patch, false);
}

{
  const parsed = parsePatchBody({
    id: "row-1",
    import_id: "import-1",
    source_table: "offers_raw",
    patch: { brand: "Brand A" },
  });
  assert.equal(parsed.id, "row-1");
  assert.equal(parsed.importId, "import-1");
  assert.equal(parsed.sourceTable, "offers_raw");
  assert.equal(parsed.patch.brand, "Brand A");
}

assert.throws(
  () =>
    parsePatchBody({
      id: "x",
      import_id: "y",
      source_table: "offers_staging" as never,
      patch: { brand: "A" },
    }),
  /source_table/
);

assert.throws(
  () => sanitizeBatchItemPatch({ price_total: "abc" }),
  /price_total musí být číslo/
);
assert.throws(
  () => sanitizeBatchItemPatch({ valid_from: "03-01-2026" }),
  /valid_from musí být datum/
);
assert.throws(() => sanitizeBatchItemPatch({}), /patch je prázdný/);

console.log("OK: batch item update validation tests passed");
