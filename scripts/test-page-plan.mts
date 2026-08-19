import assert from "node:assert/strict";
import { planLeafletPages } from "../lib/leaflet-review/page-plan.ts";

assert.deepEqual(
  planLeafletPages([{ page_no: 1, status: "pending" }, { page_no: 2, status: "pending" }, { page_no: 3, status: "pending" }], 3),
  [1, 2, 3],
  "new processing must start at page 1 and advance in order",
);
assert.deepEqual(
  planLeafletPages([{ page_no: 1, status: "completed" }, { page_no: 2, status: "completed" }, { page_no: 3, status: "failed" }, { page_no: 4, status: "pending" }], 4),
  [3, 4],
  "resume must start at first incomplete page and then advance",
);
assert.deepEqual(
  planLeafletPages([{ page_no: 3, status: "pending" }, { page_no: 1, status: "completed" }, { page_no: 2, status: "pending" }], 3),
  [2, 3],
  "database row order must not affect page order",
);
assert.deepEqual(planLeafletPages([], 3, true), [1, 2, 3], "force reread still runs 1..N in order");

console.log("PASS page plan: starts at 1, advances N→N+1, resumes at first incomplete page");
