import assert from "node:assert/strict";
import { sanitizeLeafletValidity } from "../lib/leaflet-review/validity-policy.ts";

assert.deepEqual(
  sanitizeLeafletValidity("2026-08-20", "2026-08-26"),
  { valid_from: "2026-08-20", valid_to: "2026-08-26", safe: true },
);
assert.deepEqual(
  sanitizeLeafletValidity(null, null),
  { valid_from: null, valid_to: null, safe: true },
);
assert.deepEqual(
  sanitizeLeafletValidity("2026-02-31", "2026-03-05"),
  { valid_from: null, valid_to: "2026-03-05", safe: false },
);
assert.deepEqual(
  sanitizeLeafletValidity("2026-12-30", "2026-01-03"),
  { valid_from: null, valid_to: null, safe: false },
);
assert.deepEqual(
  sanitizeLeafletValidity("neznamo", null),
  { valid_from: null, valid_to: null, safe: false },
);

console.log("PASS leaflet validity: valid dates preserved, unsafe evidence becomes null");
