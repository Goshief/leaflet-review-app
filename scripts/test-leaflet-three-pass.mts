import assert from "node:assert/strict";
import {
  createMemoryPdfIntakeBackend,
  ingestOriginalPdf,
} from "../lib/leaflet-monitor/pdf-intake.ts";
import {
  createMemoryPdfPagesBackend,
  ensurePagesAfterDownload,
} from "../lib/leaflet-monitor/pdf-pages.ts";
import {
  createMemoryPageParserBackend,
  runAutomaticPageParse,
} from "../lib/leaflet-monitor/page-parser.ts";
import { VERIFIED_PRODUCT_KEYS, summarizeThreePassOffers, type Pass3FieldDecision } from "../lib/leaflet/ai-checks.ts";
import type { LeafletProduct } from "../lib/leaflet/leaflet-product.ts";
import { renderPdfPagesToPng } from "../lib/pdf/render-pages-node.ts";

function makeMinimalPdf(): Uint8Array {
  const parts: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [];
  const add = (n: number, body: string) => {
    offsets[n] = parts.reduce((sum, part) => sum + part.length, 0);
    parts.push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  add(1, "<< /Type /Catalog /Pages 2 0 R >>");
  add(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  add(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>");
  const startxref = parts.reduce((sum, part) => sum + part.length, 0);
  let xref = "xref\n0 4\n0000000000 65535 f \n";
  for (let i = 1; i < 4; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  parts.push(xref);
  parts.push(`trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);
  return Uint8Array.from(Buffer.from(parts.join(""), "latin1"));
}

function sampleProduct(partial: Partial<LeafletProduct> = {}): LeafletProduct {
  return {
    store_id: "billa",
    source_type: "leaflet",
    page_no: 1,
    valid_from: "2026-08-05",
    valid_to: "2026-08-11",
    valid_from_text: "od středy 5. 8.",
    valid_to_text: "do úterý 11. 8. 2026.",
    extracted_name: "Jogurt bílý",
    price_total: 12.9,
    currency: "CZK",
    pack_qty: 1,
    pack_unit: "ks",
    pack_unit_qty: 1,
    price_standard: null,
    typical_price_per_unit: null,
    price_with_loyalty_card: null,
    has_loyalty_card_price: false,
    notes: null,
    brand: null,
    category: null,
    raw_text_block: "Jogurt bílý 12,90",
    ...partial,
  };
}

function decisionsFrom(
  product: LeafletProduct,
  overrides: Partial<Record<string, Pass3FieldDecision>> = {},
): Partial<Record<string, Pass3FieldDecision>> {
  return {
    ...Object.fromEntries(VERIFIED_PRODUCT_KEYS.map((key) => [key, { value: product[key], seen: true }])),
    ...overrides,
  };
}

const pdf = makeMinimalPdf();
const intake = createMemoryPdfIntakeBackend();
const pagesBackend = createMemoryPdfPagesBackend(intake.rows, intake.files);
const parser = createMemoryPageParserBackend();
const pass2Crops: number[] = [];
const pass2SawPass1Name: boolean[] = [];

const archive = await ingestOriginalPdf(intake, {
  store_id: "billa",
  source_url: "https://www.billa.cz/letaky-billa/velky-letak",
  pdf_source_url: "https://cdn.example/one-page.pdf",
  bytes: pdf,
  content_type: "application/pdf",
  valid_from: "2026-08-05",
  downloaded_at: "2026-09-01T12:00:00.000Z",
});

const jogurt = sampleProduct({ extracted_name: "Jogurt bílý", price_total: 12.9, pack_unit: "ks" });
const maslo = sampleProduct({
  extracted_name: "Máslo 250 g",
  price_total: 39.9,
  pack_unit: "g",
  pack_unit_qty: 250,
  raw_text_block: "Máslo 250 g 39,90",
});

const split = await ensurePagesAfterDownload(pagesBackend, archive, pdf, renderPdfPagesToPng, {
  onPageImage: async (ctx) => {
    await runAutomaticPageParse({ pages: pagesBackend, parser }, ctx, {
      threePass: {
        pass1: async () => ({
          raw: JSON.stringify([
            { ...jogurt, bbox: { x: 0, y: 0, width: 0.5, height: 1 } },
            { ...maslo, bbox: { x: 0.5, y: 0, width: 0.5, height: 1 } },
          ]),
          model: "test-pass1",
        }),
        pass2: async (input) => {
          pass2Crops.push(input.crop.byteLength);
          pass2SawPass1Name.push(!("pass1" in input));
          assert.ok(input.pageImage.byteLength > 0);
          assert.ok(input.crop.byteLength > 0);
          assert.equal(input.request.batch_id, archive.batch_id);
          assert.equal(input.request.page_id, ctx.page.page_id);
          assert.equal(input.request.page_no, 1);
          assert.equal(input.request.store_id, "billa");
          assert.equal(input.request.adapter.id, "billa");
          if (input.index === 0) {
            return sampleProduct({ extracted_name: "Jogurt bílý", price_total: 19.9, pack_unit: "ks" });
          }
          return maslo;
        },
        pass3: async (input) => {
          assert.ok(input.pageImage.byteLength > 0);
          assert.ok(input.crop.byteLength > 0);
          assert.ok(input.pass1);
          if (input.index === 0) {
            return decisionsFrom(jogurt, {
              price_total: { value: 12.9, seen: true },
              pack_unit: { value: null, seen: false },
            });
          }
          return decisionsFrom(maslo);
        },
      },
    });
  },
});

assert.equal(split.pages.length, 1);
assert.equal(split.pages[0]?.processing_status, "parsed");
assert.equal(parser.staging.length, 2);
assert.equal(pass2Crops.length, 2);
assert.equal(pass2SawPass1Name.every(Boolean), true);

const first = parser.staging.find((row) => row.extracted_name === "Jogurt bílý");
const second = parser.staging.find((row) => row.extracted_name === "Máslo 250 g");
assert.ok(first && second);
assert.equal(first.price_total, 12.9);
assert.equal(first.pack_unit, null);
assert.equal(first.review_status, "needs_review");
assert.equal(first.ai_checks?.extracted_name.status, "confirmed");
assert.equal(first.ai_checks?.extracted_name.agreement, 3);
assert.equal(first.ai_checks?.price_total.status, "verified_by_pass_3");
assert.equal(first.ai_checks?.pack_unit.status, "unresolved");
assert.equal(second.review_status, "pending");
assert.equal(second.ai_checks?.extracted_name.status, "confirmed");
assert.equal(second.ai_checks?.extracted_name.agreement, 3);
assert.equal(parser.staging.every((row) => row.review_status !== "approved"), true);
assert.equal(first.ai_checks?.passes, 3);
assert.equal(second.ai_checks?.passes, 3);

const summary = summarizeThreePassOffers(parser.staging);
assert.equal(summary.products, 2);
assert.equal(summary.pass3_resolved_conflicts, 1);
assert.equal(summary.needs_review, 1);
assert.equal(summary.unresolved_fields, 1);
assert.ok(summary.fields_3_of_3 >= 1);

console.log(JSON.stringify({
  page: 1,
  products: summary.products,
  fields_3_of_3: summary.fields_3_of_3,
  pass3_resolved_conflicts: summary.pass3_resolved_conflicts,
  needs_review: summary.needs_review,
  unresolved_fields: summary.unresolved_fields,
}, null, 2));

console.log("PASS leaflet 3-pass: one page, independent re-read, verifier by image, never auto-approved");
