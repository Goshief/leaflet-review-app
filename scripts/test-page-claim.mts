import assert from "node:assert/strict";
import { claimLeafletPage, failLeafletPageClaim } from "../lib/leaflet-review/page-claim.ts";

type Row = { leaflet_id: string; page_no: number; status: string; processing_error?: string | null; updated_at?: string };

function fakeSupabase(rows: Row[]) {
  return {
    from(table: string) {
      assert.equal(table, "leaflet_page_processing");
      let patch: Partial<Row> = {};
      const predicates: Array<(row: Row) => boolean> = [];
      const builder: any = {
        update(next: Partial<Row>) { patch = next; return builder; },
        eq(field: keyof Row, value: unknown) { predicates.push((row) => row[field] === value); return builder; },
        in(field: keyof Row, values: unknown[]) { predicates.push((row) => values.includes(row[field])); return builder; },
        async select() {
          const matched = rows.filter((row) => predicates.every((predicate) => predicate(row)));
          for (const row of matched) Object.assign(row, patch);
          return { data: matched.map((row) => ({ page_no: row.page_no })), error: null };
        },
        then(resolve: (value: unknown) => unknown) {
          const matched = rows.filter((row) => predicates.every((predicate) => predicate(row)));
          for (const row of matched) Object.assign(row, patch);
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

{
  const rows: Row[] = [{ leaflet_id: "leaflet-1", page_no: 3, status: "pending" }];
  const s = fakeSupabase(rows);
  const [first, second] = await Promise.all([
    claimLeafletPage(s, "leaflet-1", 3),
    claimLeafletPage(s, "leaflet-1", 3),
  ]);
  assert.equal(Number(first) + Number(second), 1, "only one concurrent caller may claim the page");
  assert.equal(rows[0].status, "processing");
}

{
  const rows: Row[] = [{ leaflet_id: "leaflet-1", page_no: 3, status: "completed" }];
  const s = fakeSupabase(rows);
  assert.equal(await claimLeafletPage(s, "leaflet-1", 3, false), false, "normal resume must not reclaim completed page");
  assert.equal(await claimLeafletPage(s, "leaflet-1", 3, true), true, "force reread may explicitly reclaim completed page");
}

{
  const rows: Row[] = [{ leaflet_id: "leaflet-1", page_no: 3, status: "processing" }];
  const s = fakeSupabase(rows);
  await failLeafletPageClaim(s, "leaflet-1", 3, new Error("boom"));
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].processing_error, "boom");
}

console.log("PASS page claim: one winner, completed pages skipped, failed claim released");
