import assert from "node:assert/strict";
import {
  dayKeyInTz,
  mapQuarantineReasonToMetricStatus,
} from "../lib/dashboard/metrics.ts";

assert.equal(mapQuarantineReasonToMetricStatus("rejected_in_ui"), "rejected");
assert.equal(mapQuarantineReasonToMetricStatus("returned_to_review"), "pending");
assert.equal(
  mapQuarantineReasonToMetricStatus("db_required_missing:missing_price_total"),
  "quarantine"
);
assert.equal(mapQuarantineReasonToMetricStatus(""), "quarantine");

const k = dayKeyInTz("2026-03-25T12:15:00.000Z", "Europe/Prague");
assert.equal(k, "2026-03-25");

console.log("OK: dashboard metrics helpers tests passed");

