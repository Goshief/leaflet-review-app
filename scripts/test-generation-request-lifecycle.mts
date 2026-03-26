import assert from "node:assert/strict";
import {
  listGenerationRequests,
  parseGenerationRequestUpdateBody,
  updateGenerationRequestLifecycle,
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
  resolved_image_key: string | null;
  error_note: string | null;
  created_at: string;
  updated_at?: string;
};

class FakeLifecycleSupabase implements SupabaseGenerationRequestClient {
  public requests: ReqRow[];

  constructor(seed: ReqRow[]) {
    this.requests = seed.map((r) => ({ ...r }));
  }

  from(table: string) {
    const self = this;
    let selected: ReqRow[] = table === "product_type_generation_requests" ? self.requests : [];
    let updatePayload: Record<string, unknown> | null = null;
    const query = {
      select(_columns: string) {
        return query;
      },
      insert(_payload: Record<string, unknown>) {
        return {
          select() {
            return {
              async maybeSingle() {
                return { data: null, error: { message: "not implemented" } };
              },
            };
          },
        };
      },
      update(payload: Record<string, unknown>) {
        updatePayload = payload;
        return query;
      },
      eq(column: string, value: string) {
        selected = selected.filter((r) => String((r as unknown as Record<string, unknown>)[column]) === value);
        return query;
      },
      order(_column: string, _options: { ascending: boolean }) {
        return query;
      },
      limit(value: number) {
        selected = selected.slice(0, value);
        return query;
      },
      async maybeSingle() {
        const row = selected[0] ?? null;
        if (!row) return { data: null, error: null };
        if (!updatePayload) return { data: row, error: null };
        Object.assign(row, updatePayload);
        return { data: row, error: null };
      },
      then(onfulfilled: (v: { data: ReqRow[]; error: null }) => unknown) {
        return Promise.resolve(onfulfilled({ data: selected, error: null }));
      },
    };
    return query;
  }
}

const seed: ReqRow[] = [
  {
    id: "req-1",
    batch_item_id: "row-1",
    import_id: "import-1",
    source_table: "offers_raw",
    product_name: "Brokolice",
    candidate_image_key: null,
    source: "leaflet-review-app",
    status: "pending",
    resolved_image_key: null,
    error_note: null,
    created_at: new Date().toISOString(),
  },
];

// list requests
{
  const fake = new FakeLifecycleSupabase(seed);
  const listed = await listGenerationRequests(fake, 100);
  assert.equal(listed.ok, true);
  if (!listed.ok) throw new Error("Expected list ok");
  assert.equal(listed.requests.length, 1);
}

// pending -> processing
{
  const fake = new FakeLifecycleSupabase(seed);
  const parsed = parseGenerationRequestUpdateBody({ id: "req-1", status: "processing" });
  const out = await updateGenerationRequestLifecycle(fake, parsed, {
    isValidImageKey: (k) => k === "butter" || k === "cheese" || k === "placeholder",
  });
  assert.equal(out.ok, true);
  assert.equal(fake.requests[0]?.status, "processing");
}

// processing -> done with valid key
{
  const fake = new FakeLifecycleSupabase([{ ...seed[0]!, status: "processing" }]);
  const parsed = parseGenerationRequestUpdateBody({
    id: "req-1",
    status: "done",
    resolvedImageKey: "cheese",
  });
  const out = await updateGenerationRequestLifecycle(fake, parsed, {
    isValidImageKey: (k) => k === "butter" || k === "cheese" || k === "placeholder",
  });
  assert.equal(out.ok, true);
  assert.equal(fake.requests[0]?.status, "done");
  assert.equal(fake.requests[0]?.resolved_image_key, "cheese");
}

// processing -> error
{
  const fake = new FakeLifecycleSupabase([{ ...seed[0]!, status: "processing" }]);
  const parsed = parseGenerationRequestUpdateBody({
    id: "req-1",
    status: "error",
    errorNote: "asset not found",
  });
  const out = await updateGenerationRequestLifecycle(fake, parsed, {
    isValidImageKey: (k) => k === "butter" || k === "cheese" || k === "placeholder",
  });
  assert.equal(out.ok, true);
  assert.equal(fake.requests[0]?.status, "error");
  assert.equal(fake.requests[0]?.error_note, "asset not found");
}

// invalid transition -> FAIL
{
  const fake = new FakeLifecycleSupabase([{ ...seed[0]!, status: "pending" }]);
  const parsed = parseGenerationRequestUpdateBody({
    id: "req-1",
    status: "done",
    resolvedImageKey: "cheese",
  });
  const out = await updateGenerationRequestLifecycle(fake, parsed, {
    isValidImageKey: (k) => k === "butter" || k === "cheese" || k === "placeholder",
  });
  assert.equal(out.ok, false);
  if (out.ok) throw new Error("Expected invalid transition fail");
  assert.equal(out.status, 400);
}

// done with invalid key -> FAIL
{
  const fake = new FakeLifecycleSupabase([{ ...seed[0]!, status: "processing" }]);
  const parsed = parseGenerationRequestUpdateBody({
    id: "req-1",
    status: "done",
    resolvedImageKey: "brokolice-neexistuje",
  });
  const out = await updateGenerationRequestLifecycle(fake, parsed, {
    isValidImageKey: (k) => k === "butter" || k === "cheese" || k === "placeholder",
  });
  assert.equal(out.ok, false);
  if (out.ok) throw new Error("Expected invalid image key fail");
  assert.equal(out.status, 400);
}

console.log("OK: generation request lifecycle tests passed");

