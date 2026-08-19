import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../components/leaflet/monitor-panel.tsx", import.meta.url), "utf8");
assert.ok(source.includes('doc?.storage_path?.toLowerCase().endsWith(".pdf")'));
assert.match(source, /isPdf\?<iframe/);
assert.match(source, /JSON manifest není PDF/);
assert.match(source, /Otevřít zdroj/);
assert.doesNotMatch(source, /const preview=doc\?`\/api\/leaflet-monitor\/pdf/);
console.log("PASS viewer preview: JSON manifest never renders through PDF endpoint");
