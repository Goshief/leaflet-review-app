import assert from "node:assert/strict";
import { discoverLeafletAssets, validateRetailerSourceHtml } from "../lib/leaflet-monitor/discovery.ts";

const padding = "x".repeat(240);
const valid = `<html><body>${padding}<a href="https://view.publitas.com/billa-cz/letak.pdf">Stáhnout PDF – velký leták</a></body></html>`;
assert.deepEqual(validateRetailerSourceHtml(valid), { ok: true, reason: "ok" });
assert.equal(discoverLeafletAssets(valid, "https://www.billa.cz/letaky-billa/velky-letak", "billa").length, 1);

const blocked = `<html><body>${padding}<h1>Access Denied</h1><a href="/catalog.pdf">catalog</a></body></html>`;
assert.deepEqual(validateRetailerSourceHtml(blocked), { ok: false, reason: "blocked" });
assert.throws(
  () => discoverLeafletAssets(blocked, "https://www.billa.cz/letaky-billa/velky-letak", "billa"),
  /source validation failed: blocked/,
);

assert.deepEqual(validateRetailerSourceHtml("   "), { ok: false, reason: "empty" });
assert.deepEqual(validateRetailerSourceHtml("plain text ".repeat(40)), { ok: false, reason: "not_html" });

console.log("PASS source validation: valid retailer HTML accepted; empty, non-HTML and blocked HTTP-200 pages rejected");
