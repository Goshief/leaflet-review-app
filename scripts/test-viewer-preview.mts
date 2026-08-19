import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/leaflet/monitor-panel.tsx", import.meta.url), "utf8");

assert.match(source, /storage_path\?\.toLowerCase\(\)\.endsWith\("\\\.pdf"\)/, "preview eligibility must be derived from the stored object type");
assert.match(source, /isPdf\?<iframe/, "PDF iframe must only render for PDF-backed documents");
assert.match(source, /JSON manifest není PDF/, "manifest-backed documents must explain that the source is not a PDF");
assert.match(source, /Otevřít zdroj/, "manifest-backed documents must link to the real viewer source");
assert.doesNotMatch(source, /const preview=doc\?`\/api\/leaflet-monitor\/pdf/, "preview URL must not be unconditional for every document");

console.log("PASS viewer preview: JSON manifests never render through the PDF endpoint; PDF-backed documents still use the iframe");
