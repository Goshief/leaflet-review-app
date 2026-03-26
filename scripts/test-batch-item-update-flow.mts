import assert from "node:assert/strict";
import {
  executePatchUpdate,
  parsePatchBody,
  type SupabaseUpdateClient,
} from "../lib/batches/item-update-route-logic.ts";
import { IMAGE_MISSING_STATUS_MESSAGE } from "../lib/product-types/resolve-batch-item-image-state.ts";

type Row = {
  id: string;
  import_id: string;
  source_table: "offers_raw" | "offers_quarantine";
  brand: string | null;
  price_total: number | null;
  extracted_name: string | null;
  currency: string | null;
  pack_qty: number | null;
  pack_unit: string | null;
  pack_unit_qty: number | null;
  price_standard: number | null;
  typical_price_per_unit: number | null;
  price_with_loyalty_card: number | null;
  has_loyalty_card_price: boolean | null;
  notes: string | null;
  category: string | null;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string | null;
  approved_image_key: string | null;
  suggested_image_key: string | null;
  image_review_status: "suggested" | "approved" | "rejected" | "manual_override" | null;
};

class FakeSupabase implements SupabaseUpdateClient {
  public tables: Record<string, Row[]>;
  private failOnUpdatedAt: boolean;

  constructor(seed: Row[], failOnUpdatedAt = false) {
    this.tables = {
      offers_raw: seed.filter((r) => r.source_table === "offers_raw").map((r) => ({ ...r })),
      offers_quarantine: seed
        .filter((r) => r.source_table === "offers_quarantine")
        .map((r) => ({ ...r })),
    };
    this.failOnUpdatedAt = failOnUpdatedAt;
  }

  from(table: string) {
    const self = this;
    let payload: Record<string, unknown> = {};
    let idFilter = "";
    let importFilter = "";
    let isUpdate = false;
    const query = {
      update(nextPayload: Record<string, unknown>) {
        isUpdate = true;
        payload = nextPayload;
        return query;
      },
      eq(column: string, value: string) {
        if (column === "id") idFilter = value;
        if (column === "import_id") importFilter = value;
        return query;
      },
      select(_columns: string) {
        return query;
      },
      async maybeSingle() {
        const rows = self.tables[table] ?? [];
        const idx = rows.findIndex((r) => r.id === idFilter && r.import_id === importFilter);
        if (idx < 0) return { data: null, error: null };

        if (isUpdate) {
          if (self.failOnUpdatedAt && "updated_at" in payload) {
            return { data: null, error: { message: 'column "updated_at" does not exist' } };
          }
          const updated = {
            ...rows[idx],
            ...payload,
          } as Row;
          rows[idx] = updated;
          const { source_table: _st, ...withoutSource } = updated;
          return { data: withoutSource, error: null };
        }

        const current = rows[idx] as Row;
        const { source_table: _st, ...withoutSource } = current;
        return { data: withoutSource, error: null };
      },
    };
    return query;
  }
}

const seedRows: Row[] = [
  {
    id: "row-1",
    import_id: "import-1",
    source_table: "offers_raw",
    brand: "OldBrand",
    price_total: 29.9,
    extracted_name: "Mleko",
    currency: "CZK",
    pack_qty: 1,
    pack_unit: "ks",
    pack_unit_qty: 1,
    price_standard: 32.9,
    typical_price_per_unit: 29.9,
    price_with_loyalty_card: null,
    has_loyalty_card_price: false,
    notes: null,
    category: "Mléčné",
    valid_from: "2026-03-01",
    valid_to: "2026-03-07",
    created_at: "2026-03-01T10:00:00.000Z",
    approved_image_key: "butter",
    suggested_image_key: "cheese",
    image_review_status: "suggested",
  },
  {
    id: "row-2",
    import_id: "import-1",
    source_table: "offers_raw",
    brand: "FallbackBrand",
    price_total: 19.9,
    extracted_name: "Syr",
    currency: "CZK",
    pack_qty: 1,
    pack_unit: "ks",
    pack_unit_qty: 1,
    price_standard: 24.9,
    typical_price_per_unit: 19.9,
    price_with_loyalty_card: null,
    has_loyalty_card_price: false,
    notes: null,
    category: "Mléčné",
    valid_from: "2026-03-01",
    valid_to: "2026-03-07",
    created_at: "2026-03-01T10:00:00.000Z",
    approved_image_key: null,
    suggested_image_key: "cheese",
    image_review_status: "suggested",
  },
  {
    id: "row-3",
    import_id: "import-1",
    source_table: "offers_raw",
    brand: "InvalidImage",
    price_total: 9.9,
    extracted_name: "X",
    currency: "CZK",
    pack_qty: 1,
    pack_unit: "ks",
    pack_unit_qty: 1,
    price_standard: 9.9,
    typical_price_per_unit: 9.9,
    price_with_loyalty_card: null,
    has_loyalty_card_price: false,
    notes: null,
    category: "Test",
    valid_from: "2026-03-01",
    valid_to: "2026-03-07",
    created_at: "2026-03-01T10:00:00.000Z",
    approved_image_key: "brokolice-neexistuje",
    suggested_image_key: null,
    image_review_status: "suggested",
  },
  {
    id: "row-4",
    import_id: "import-1",
    source_table: "offers_raw",
    brand: "NoImage",
    price_total: 12.9,
    extracted_name: "Y",
    currency: "CZK",
    pack_qty: 1,
    pack_unit: "ks",
    pack_unit_qty: 1,
    price_standard: 12.9,
    typical_price_per_unit: 12.9,
    price_with_loyalty_card: null,
    has_loyalty_card_price: false,
    notes: null,
    category: "Test",
    valid_from: "2026-03-01",
    valid_to: "2026-03-07",
    created_at: "2026-03-01T10:00:00.000Z",
    approved_image_key: null,
    suggested_image_key: null,
    image_review_status: "suggested",
  },
];

// 1) whitelist source_table: invalid value must be rejected
assert.throws(
  () =>
    parsePatchBody({
      id: "row-1",
      import_id: "import-1",
      source_table: "offers_staging" as never,
      patch: { brand: "NewBrand" },
    }),
  /source_table/
);

// 2) update flow: same id must update existing row (no insert fallback)
{
  const fake = new FakeSupabase(seedRows);
  const beforeCount = fake.tables.offers_raw.length;

  const parsed = parsePatchBody({
    id: "row-1",
    import_id: "import-1",
    source_table: "offers_raw",
    patch: { brand: "NewBrand", price_total: 24.9 },
  });

  const result = await executePatchUpdate(fake, parsed);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected successful update");

  const afterCount = fake.tables.offers_raw.length;
  assert.equal(afterCount, beforeCount, "count must stay unchanged after update");
  assert.equal(fake.tables.offers_raw[0]?.brand, "NewBrand");
  assert.equal(fake.tables.offers_raw[0]?.price_total, 24.9);
  assert.equal(result.item.source_table, "offers_raw");
}

// 3) missing row must not create new row
{
  const fake = new FakeSupabase(seedRows);
  const beforeCount = fake.tables.offers_raw.length;

  const parsed = parsePatchBody({
    id: "missing-row",
    import_id: "import-1",
    source_table: "offers_raw",
    patch: { brand: "X" },
  });
  const result = await executePatchUpdate(fake, parsed);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected not found result");
  assert.equal(result.status, 404);
  assert.equal(fake.tables.offers_raw.length, beforeCount, "no insert fallback allowed");
}

// 4) emulate endpoint retry path when updated_at column is missing
{
  const fake = new FakeSupabase(seedRows, true);
  const parsed = parsePatchBody({
    id: "row-1",
    import_id: "import-1",
    source_table: "offers_raw",
    patch: { brand: "RetryBrand" },
  });
  const result = await executePatchUpdate(fake, parsed);
  assert.equal(result.ok, true);
  assert.equal(fake.tables.offers_raw[0]?.brand, "RetryBrand");
}

// 5) approve with valid resolved key => PASS
{
  const fake = new FakeSupabase(seedRows);
  const parsed = parsePatchBody({
    id: "row-2",
    import_id: "import-1",
    source_table: "offers_raw",
    patch: {
      approved_image_key: "cheese",
      image_review_status: "approved",
    },
  });
  const result = await executePatchUpdate(fake, parsed);
  assert.equal(result.ok, true);
  const row = fake.tables.offers_raw.find((r) => r.id === "row-2");
  assert.equal(row?.approved_image_key, "cheese");
  assert.equal(row?.image_review_status, "approved");
}

// 6) reject => PASS (no forced valid image key)
{
  const fake = new FakeSupabase(seedRows);
  const parsed = parsePatchBody({
    id: "row-4",
    import_id: "import-1",
    source_table: "offers_raw",
    patch: { image_review_status: "rejected" },
  });
  const result = await executePatchUpdate(fake, parsed);
  assert.equal(result.ok, true);
  const row = fake.tables.offers_raw.find((r) => r.id === "row-4");
  assert.equal(row?.approved_image_key, null);
  assert.equal(row?.image_review_status, "rejected");
}

// 7) manual override with valid key => PASS
{
  const fake = new FakeSupabase(seedRows);
  const parsed = parsePatchBody({
    id: "row-4",
    import_id: "import-1",
    source_table: "offers_raw",
    patch: {
      approved_image_key: "butter",
      image_review_status: "manual_override",
    },
  });
  const result = await executePatchUpdate(fake, parsed);
  assert.equal(result.ok, true);
  const row = fake.tables.offers_raw.find((r) => r.id === "row-4");
  assert.equal(row?.approved_image_key, "butter");
  assert.equal(row?.image_review_status, "manual_override");
}

// 8) manual override with invalid key => FAIL 400
{
  const fake = new FakeSupabase(seedRows);
  const parsed = parsePatchBody({
    id: "row-1",
    import_id: "import-1",
    source_table: "offers_raw",
    patch: {
      approved_image_key: "brokolice-neexistuje",
      image_review_status: "manual_override",
    },
  });
  const before = fake.tables.offers_raw.find((r) => r.id === "row-1")?.approved_image_key;
  const result = await executePatchUpdate(fake, parsed);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected manual override image validation failure");
  assert.equal(result.status, 400);
  assert.equal(result.error, IMAGE_MISSING_STATUS_MESSAGE);
  assert.equal(fake.tables.offers_raw.find((r) => r.id === "row-1")?.approved_image_key, before);
}

console.log("OK: batch item update flow tests passed");
