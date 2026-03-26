import assert from "node:assert/strict";
import {
  createOrReuseGenerationRequest,
  parseGenerationRequestBody,
  type SupabaseGenerationRequestClient,
} from "../lib/product-types/generation-request-route-logic.ts";

type ReqRow = {
  id: string;
  batch_item_id: string;
  import_id: string;
  source_table: "offers_raw" | "offers_quarantine";
  product_name: string | null;
  candidate_image_key: string | null;
  source: string;
  status: "pending" | "processing" | "done" | "error";
  created_at: string;
};

class FakeGenerationSupabase implements SupabaseGenerationRequestClient {
  public rows: ReqRow[];
  public failInsert = false;

  constructor(seed: ReqRow[] = []) {
    this.rows = [...seed];
  }

  from(_table: string) {
    const self = this;
    const filters: Record<string, string> = {};
    let isInsert = false;
    let insertPayload: Record<string, unknown> | null = null;

    const query = {
      select(_columns: string) {
        return query;
      },
      eq(column: string, value: string) {
        filters[column] = value;
        return query;
      },
      order(_column: string, _options: { ascending: boolean }) {
        return query;
      },
      async limit(value: number) {
        const list = self.rows.filter((r) =>
          Object.entries(filters).every(([k, v]) => String((r as unknown as Record<string, unknown>)[k]) === v)
        );
        return { data: list.slice(0, value), error: null };
      },
      insert(payload: Record<string, unknown>) {
        isInsert = true;
        insertPayload = payload;
        return query;
      },
      maybeSingle: async () => {
        if (!isInsert) return { data: null, error: { message: "not insert mode" } };
        if (self.failInsert) return { data: null, error: { message: "insert failed" } };
        const now = new Date().toISOString();
        const row: ReqRow = {
          id: `req-${self.rows.length + 1}`,
          batch_item_id: String(insertPayload?.batch_item_id),
          import_id: String(insertPayload?.import_id),
          source_table: (insertPayload?.source_table as ReqRow["source_table"]) ?? "offers_raw",
          product_name: (insertPayload?.product_name as string | null) ?? null,
          candidate_image_key: (insertPayload?.candidate_image_key as string | null) ?? null,
          source: String(insertPayload?.source ?? "leaflet-review-app"),
          status: (insertPayload?.status as ReqRow["status"]) ?? "pending",
          created_at: now,
        };
        self.rows.push(row);
        return { data: row, error: null };
      },
    };

    return query;
  }
}

// parse payload
{
  const parsed = parseGenerationRequestBody({
    batchItemId: "row-1",
    importId: "11111111-1111-1111-1111-111111111111",
    sourceTable: "offers_raw",
    productName: "Brokolice",
    candidateImageKey: null,
    source: "leaflet-review-app",
  });
  assert.equal(parsed.batchItemId, "row-1");
  assert.equal(parsed.source, "leaflet-review-app");
}

// 1) create new request => PASS
{
  const fake = new FakeGenerationSupabase();
  const parsed = parseGenerationRequestBody({
    batchItemId: "row-1",
    importId: "11111111-1111-1111-1111-111111111111",
    sourceTable: "offers_raw",
    productName: "Brokolice",
    candidateImageKey: null,
    source: "leaflet-review-app",
  });
  const result = await createOrReuseGenerationRequest(fake, parsed);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected success");
  assert.equal(result.created, true);
  assert.equal(fake.rows.length, 1);
}

// 2) repeated request => no duplicate pending
{
  const fake = new FakeGenerationSupabase([
    {
      id: "req-1",
      batch_item_id: "row-1",
      import_id: "11111111-1111-1111-1111-111111111111",
      source_table: "offers_raw",
      product_name: "Brokolice",
      candidate_image_key: null,
      source: "leaflet-review-app",
      status: "pending",
      created_at: new Date().toISOString(),
    },
  ]);
  const parsed = parseGenerationRequestBody({
    batchItemId: "row-1",
    importId: "11111111-1111-1111-1111-111111111111",
    sourceTable: "offers_raw",
    productName: "Brokolice",
    candidateImageKey: null,
    source: "leaflet-review-app",
  });
  const result = await createOrReuseGenerationRequest(fake, parsed);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected success");
  assert.equal(result.created, false);
  assert.equal(fake.rows.length, 1);
}

// 3) error path => friendly fail
{
  const fake = new FakeGenerationSupabase();
  fake.failInsert = true;
  const parsed = parseGenerationRequestBody({
    batchItemId: "row-2",
    importId: "11111111-1111-1111-1111-111111111111",
    sourceTable: "offers_raw",
    productName: "Paprika",
    candidateImageKey: "placeholder",
    source: "leaflet-review-app",
  });
  const result = await createOrReuseGenerationRequest(fake, parsed);
  assert.equal(result.ok, false);
}

console.log("OK: generation request flow tests passed");

