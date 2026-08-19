import assert from "node:assert/strict";
import { analyzePageCompletion, firstIncompletePage } from "../lib/leaflet-review/page-state.ts";

function completed(pageCount: number) {
  return Array.from({ length: pageCount }, (_, i) => ({ page_no: i + 1, status: "completed" }));
}

{
  const result = analyzePageCompletion(completed(3), 3);
  assert.equal(result.isComplete, true, "1..N completed exactly once must finalize");
  assert.equal(result.completedCount, 3);
  assert.equal(firstIncompletePage(completed(3), 3), null);
}

{
  const states = [{ page_no: 1, status: "completed" }, { page_no: 1, status: "completed" }, { page_no: 2, status: "completed" }];
  const result = analyzePageCompletion(states, 3);
  assert.equal(result.isComplete, false, "same count with duplicate/missing page must not finalize");
  assert.deepEqual(result.duplicatePages, [1]);
  assert.deepEqual(result.missingPages, [3]);
  assert.equal(firstIncompletePage(states, 3), 1);
}

{
  const states = completed(3);
  states[1] = { page_no: 2, status: "failed" };
  const result = analyzePageCompletion(states, 3);
  assert.equal(result.isComplete, false, "failed page must block finalization");
  assert.deepEqual(result.unfinishedPages, [2]);
  assert.equal(firstIncompletePage(states, 3), 2);
}

{
  const states = [...completed(3), { page_no: 4, status: "completed" }];
  const result = analyzePageCompletion(states, 3);
  assert.equal(result.isComplete, false, "out-of-range page must block finalization");
  assert.deepEqual(result.outOfRangePages, [4]);
}

console.log("PASS page finalization invariant: exact 1..N completed once, no gaps/duplicates/out-of-range/unfinished pages");
