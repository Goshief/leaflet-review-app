import assert from "node:assert/strict";
import { mapOffersForImportRun } from "../lib/import-run/map-offers.ts";

const baseMeta = {
  import_id: "imp-1",
  source_type: "leaflet",
  source_url: "https://example.test",
  today_iso: "2026-03-25",
};

function runOne(offer: any, status: "approved" | "pending" | "rejected" | "quarantine" = "approved") {
  return mapOffersForImportRun({
    offers: [offer],
    row_status: { 0: status },
    meta: baseMeta,
  });
}

// missing extracted_name => quarantine
{
  const r = runOne({ price_total: 10, currency: "CZK", valid_to: "2026-03-30", store_id: "lidl" });
  assert.equal(r.counts.raw, 0);
  assert.equal(r.counts.quarantine, 1);
  assert.ok(r.requiredFieldErrors[0]?.problems.includes("missing_extracted_name"));
}

// invalid price_total => quarantine
{
  const r = runOne({ extracted_name: "Kofola", price_total: "abc", currency: "CZK", valid_to: "2026-03-30", store_id: "lidl" });
  assert.equal(r.counts.raw, 0);
  assert.equal(r.counts.quarantine, 1);
  assert.ok(r.requiredFieldErrors[0]?.problems.includes("bad_price_total"));
}

// invalid currency => quarantine
{
  const r = runOne({ extracted_name: "Kofola", price_total: 10, currency: "EUR", valid_to: "2026-03-30", store_id: "lidl" });
  assert.equal(r.counts.raw, 0);
  assert.equal(r.counts.quarantine, 1);
  assert.ok(r.requiredFieldErrors[0]?.problems.includes("bad_currency"));
}

// missing valid_to with fallback => ok (today_iso fallback)
{
  const r = runOne({ extracted_name: "Kofola", price_total: 10, currency: "CZK", store_id: "lidl" });
  assert.equal(r.counts.raw, 1);
  assert.equal(r.counts.quarantine, 0);
}

// missing valid_to without fallback => quarantine
{
  const r = mapOffersForImportRun({
    offers: [{ extracted_name: "Kofola", price_total: 10, currency: "CZK", store_id: "lidl" }],
    row_status: { 0: "approved" },
    meta: { ...baseMeta, today_iso: "" },
  });
  assert.equal(r.counts.raw, 0);
  assert.equal(r.counts.quarantine, 1);
  assert.ok(r.requiredFieldErrors[0]?.problems.includes("missing_valid_to"));
}

console.log("OK: mapOffersForImportRun tests passed");

