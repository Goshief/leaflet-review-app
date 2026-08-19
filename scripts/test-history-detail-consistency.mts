import assert from "node:assert/strict";
import { historyItemFromDocument } from "../lib/leaflet-monitor/history-item.ts";

const document = {
  id: "leaflet-1",
  retailer_id: "billa",
  filename: "billa.pdf",
  created_at: "2026-08-19T08:00:00.000Z",
  updated_at: "2026-08-19T08:10:00.000Z",
  processing_status: "ready_for_review",
  page_count: 33,
  processed_pages: 33,
  approved_count: 4,
  rejected_count: 2,
  quarantine_count: 3,
  unreviewed_count: 10,
  candidate_count: 19,
  valid_from: "2026-08-20",
  valid_to: "2026-08-26",
  notification_status: "sent",
};
const history = historyItemFromDocument(document);
assert.equal(history.id, document.id);
assert.equal(history.retailer, document.retailer_id);
assert.equal(history.pdf, document.filename);
assert.equal(history.status, document.processing_status);
assert.equal(history.page_count, document.page_count);
assert.equal(history.processed_pages, document.processed_pages);
assert.equal(history.approved_count, document.approved_count);
assert.equal(history.rejected_count, document.rejected_count);
assert.equal(history.quarantine_count, document.quarantine_count);
assert.equal(history.unreviewed_count, document.unreviewed_count);
assert.equal(history.candidate_count, document.candidate_count);
assert.equal(history.valid_from, document.valid_from);
assert.equal(history.valid_to, document.valid_to);

console.log("PASS history/detail consistency: status, counts and validity come from the same document row");
