import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/leaflet-monitor/viewer-processing.ts", import.meta.url), "utf8");

assert.match(source, /extractAllViewerCandidates\(page\.text, page\.page_no\)/, "viewer pages must extract candidates from every page text");
assert.match(source, /await replacePageCandidates\(s, doc, page\)/, "every manifest page must run candidate persistence");
assert.doesNotMatch(source, /if \(state\?\.status === "completed"\) continue/, "completed pages must remain eligible for idempotent candidate backfill");
assert.match(source, /upsert\(row, \{ onConflict: "leaflet_id,candidate_key" \}\)/, "candidate persistence must be idempotent");
assert.match(source, /const counts = await getCounts\(s, doc\.id\)/, "document counters must be rebuilt from persisted candidates");

const extractionAt = source.indexOf("await replacePageCandidates(s, doc, page)");
const completionAt = source.indexOf('status: "completed"', extractionAt);
assert.ok(extractionAt >= 0 && completionAt > extractionAt, "a page may become completed only after candidate extraction/persistence");

console.log("PASS viewer processing contract: every page backfills candidates before completion and final counts come from DB");
