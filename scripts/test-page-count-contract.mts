import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/leaflet-review/processor.ts", import.meta.url), "utf8");
assert.match(source, /page_count\s*:\s*doc\.numPages/, "leaflet_documents.page_count must come from parsed PDF numPages");
assert.match(source, /ensurePageRows\(s\s*,\s*leaflet\.id\s*,\s*doc\.numPages/, "page-state rows must use the same parsed PDF numPages");
assert.match(source, /pageNo\s*>\s*doc\.numPages/, "page processing must reject pages outside parsed PDF range");
console.log("PASS page count contract: DB count, page rows and processing bounds all use parsed PDF numPages");
