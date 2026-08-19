import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validatePdfBytes } from "../lib/leaflet-monitor/pdf-validation.ts";

const validBytes = new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(800)}\n%%EOF`);
const validSha = createHash("sha256").update(validBytes).digest("hex");
assert.deepEqual(validatePdfBytes(validBytes, validSha), { ok: true, reason: "ok", sha256: validSha });

const htmlDisguisedAsPdf = new TextEncoder().encode(`<html><body>${"x".repeat(800)}</body></html>`);
assert.equal(validatePdfBytes(htmlDisguisedAsPdf).reason, "bad_signature", "HTML must never pass as PDF even if a server labels it application/pdf");

const tinyPdfHeaderOnly = new TextEncoder().encode("%PDF-1.7");
assert.equal(validatePdfBytes(tinyPdfHeaderOnly).reason, "too_small");

assert.equal(validatePdfBytes(validBytes, "0".repeat(64)).reason, "sha256_mismatch", "stored object must match the detected PDF hash");
console.log("PASS PDF validation: signature, minimum size and storage SHA-256 integrity enforced");
