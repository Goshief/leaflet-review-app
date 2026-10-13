import assert from "node:assert/strict";
import { isPendingLeafletDocument, selectNextPendingLeaflet, type PendingLeafletDocument } from "../lib/leaflet-review/processing-queue.ts";

const today = "2026-10-13";
const staleBefore = "2026-10-13T06:00:00.000Z";
const doc = (patch: Partial<PendingLeafletDocument> = {}): PendingLeafletDocument => ({
  id: "doc",
  retailer_id: "lidl",
  storage_bucket: "leaflet-intake",
  storage_path: "lidl/catalog-current.pdf",
  source_url: "https://assets.leaflets.schwarz/current.pdf",
  valid_to: "2026-10-14",
  processing_status: "downloaded",
  updated_at: "2026-10-13T05:00:00.000Z",
  created_at: "2026-10-12T07:00:00.000Z",
  ...patch,
});

assert.equal(isPendingLeafletDocument(doc(), today, staleBefore), true);
assert.equal(isPendingLeafletDocument(doc({ valid_to: "2026-10-12" }), today, staleBefore), false);
assert.equal(isPendingLeafletDocument(doc({ storage_path: "lidl/remote-catalog-current.pdf" }), today, staleBefore), false);
assert.equal(isPendingLeafletDocument(doc({ storage_path: "penny/catalog-current.html" }), today, staleBefore), false);
assert.equal(isPendingLeafletDocument(doc({ processing_status: "ready_for_review" }), today, staleBefore), false);
assert.equal(isPendingLeafletDocument(doc({ processing_status: "processing", updated_at: "2026-10-13T06:01:00.000Z" }), today, staleBefore), false);
assert.equal(isPendingLeafletDocument(doc({ processing_status: "processing", updated_at: "2026-10-13T05:59:00.000Z" }), today, staleBefore), true);

const selected = selectNextPendingLeaflet([
  doc({ id: "later", valid_to: "2026-10-20", created_at: "2026-10-08T07:00:00.000Z" }),
  doc({ id: "soon", valid_to: "2026-10-14", created_at: "2026-10-12T08:00:00.000Z" }),
  doc({ id: "same-expiry-older", valid_to: "2026-10-14", created_at: "2026-10-12T07:00:00.000Z" }),
], today, staleBefore);
assert.equal(selected?.id, "same-expiry-older");

console.log("PASS pending leaflet queue: current PDFs only, stale-run recovery, expiring-first ordering");
