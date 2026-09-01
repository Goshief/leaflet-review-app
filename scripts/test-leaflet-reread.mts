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
import {
  createMemoryRereadAuditBackend,
  rereadPageFromImage,
  rereadProductFromImage,
} from "../lib/leaflet-monitor/page-reread.ts";
import { emptyFieldSources, mergeKeepingHumanFields } from "../lib/leaflet/field-source.ts";
import { PARSER_VERSION } from "../lib/leaflet/parser-versions.ts";
import { ADAPTER_VERSION } from "../lib/leaflet/retailer-adapter.ts";
import type { LeafletProduct } from "../lib/leaflet/leaflet-product.ts";
import { VERIFIED_PRODUCT_KEYS, type Pass3FieldDecision } from "../lib/leaflet/ai-checks.ts";
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

{
  const current = sampleProduct({ extracted_name: "Ruční jogurt", price_total: 12.9 });
  const ai = sampleProduct({ extracted_name: "AI jogurt", price_total: 99.9 });
  const sources = emptyFieldSources();
  sources.extracted_name = "human";
  const merged = mergeKeepingHumanFields(current, ai, sources);
  assert.equal(merged.product.extracted_name, "Ruční jogurt");
  assert.equal(merged.product.price_total, 99.9);
  assert.equal(merged.ai_proposal.extracted_name, "AI jogurt");
  assert.equal(merged.field_sources.extracted_name, "human");
  assert.equal(merged.field_sources.price_total, "ai");
}

const pdf = makeMinimalPdf();
const intake = createMemoryPdfIntakeBackend();
const pagesBackend = createMemoryPdfPagesBackend(intake.rows, intake.files);
const parser = createMemoryPageParserBackend();
const audit = createMemoryRereadAuditBackend();
const pass2Images: number[] = [];
const pass2Crops: number[] = [];
const pass2GotOcrText: boolean[] = [];

const jogurt = sampleProduct({ extracted_name: "Jogurt bílý", price_total: 12.9 });
const maslo = sampleProduct({
  extracted_name: "Máslo 250 g",
  price_total: 39.9,
  pack_unit: "g",
  pack_unit_qty: 250,
  raw_text_block: "Máslo 250 g 39,90",
});

const archive = await ingestOriginalPdf(intake, {
  store_id: "billa",
  source_url: "https://www.billa.cz/letaky-billa/velky-letak",
  pdf_source_url: "https://cdn.example/reread.pdf",
  bytes: pdf,
  content_type: "application/pdf",
  valid_from: "2026-08-05",
  downloaded_at: "2026-09-01T12:00:00.000Z",
});

const hooks = {
  pass1: async () => ({
    raw: JSON.stringify([
      { ...jogurt, bbox: { x: 0, y: 0, width: 0.5, height: 1 } },
      { ...maslo, bbox: { x: 0.5, y: 0, width: 0.5, height: 1 } },
    ]),
    model: "test-reread-pass1",
  }),
  pass2: async (input: { pageImage: Uint8Array; crop: Uint8Array; request: { image?: Uint8Array }; index: number }) => {
    pass2Images.push(input.pageImage.byteLength);
    pass2Crops.push(input.crop.byteLength);
    pass2GotOcrText.push("words" in input || "ocr" in input || "text" in input);
    assert.ok(input.pageImage.byteLength > 0, "PASS 2 musí dostat originální page image");
    assert.ok(input.crop.byteLength > 0, "PASS 2 musí dostat product crop z obrazu");
    return input.index === 0
      ? sampleProduct({ extracted_name: "AI jogurt přepsaný", price_total: 18.9 })
      : sampleProduct({ extracted_name: "Máslo 250 g", price_total: 44.9, pack_unit: "g", pack_unit_qty: 250 });
  },
  pass3: async (input: { index: number; pageImage: Uint8Array; crop: Uint8Array }) => {
    assert.ok(input.pageImage.byteLength > 0);
    assert.ok(input.crop.byteLength > 0);
    if (input.index === 0) {
      return decisionsFrom(sampleProduct({ extracted_name: "AI jogurt přepsaný", price_total: 18.9 }));
    }
    return decisionsFrom(sampleProduct({ extracted_name: "Máslo 250 g", price_total: 44.9, pack_unit: "g", pack_unit_qty: 250 }));
  },
};

const split = await ensurePagesAfterDownload(pagesBackend, archive, pdf, renderPdfPagesToPng, {
  onPageImage: async (ctx) => {
    await runAutomaticPageParse({ pages: pagesBackend, parser }, ctx, { threePass: hooks });
  },
});

assert.equal(split.pages.length, 1);
assert.equal(parser.parserRuns.length, 1);
const firstRunId = parser.parserRuns[0]!.id;
assert.equal(parser.staging.length, 2);
const yog = parser.staging[0]!;
assert.ok(yog);
yog.extracted_name = "Ruční jogurt";
yog.field_sources = emptyFieldSources();
yog.field_sources.extracted_name = "human";

const page = pagesBackend.pages[0]!;
const image = await pagesBackend.getPageImage(page.image_storage_path);
assert.ok(image && image.byteLength > 0);

const ctx = { archive, page, image };
const existing = parser.staging.map((row) => ({
  ...row,
  bbox: row.ai_checks?.bbox ?? null,
}));

const pageReread = await rereadPageFromImage(
  { pages: pagesBackend, parser, audit },
  ctx,
  existing,
  firstRunId,
  hooks,
);

assert.equal(parser.parserRuns.length, 2, "page re-read musí vytvořit nový parser_run");
assert.ok(parser.parserRuns.some((row) => row.id === firstRunId), "starý parser_run se nesmí smazat");
assert.equal(pageReread.run.id, parser.parserRuns[1]!.id);
assert.notEqual(pageReread.run.id, firstRunId);
assert.equal(pageReread.audit.previous_run_id, firstRunId);
assert.equal(pageReread.audit.new_run_id, pageReread.run.id);
assert.equal(pageReread.audit.parser_version, PARSER_VERSION);
assert.equal(pageReread.audit.adapter_version, ADAPTER_VERSION);
assert.equal(pageReread.audit.model_version, "test-reread-pass1");
assert.equal(pageReread.audit.scope, "page");
assert.ok(pageReread.audit.created_at);

const humanAfterPage = pageReread.offers.find((row) => row.id === yog.id)!;
assert.equal(humanAfterPage.extracted_name, "Ruční jogurt", "human edit se nesmí potichu přepsat");
assert.equal(humanAfterPage.field_sources?.extracted_name, "human");
assert.equal(humanAfterPage.ai_proposal?.extracted_name, "AI jogurt přepsaný");
assert.equal(humanAfterPage.price_total, 18.9);
assert.notEqual(humanAfterPage.review_status, "approved");

const butter = pageReread.offers.find((row) => String(row.extracted_name).includes("Máslo"))!;
assert.equal(butter.price_total, 44.9);
assert.equal(pass2GotOcrText.every((flag) => flag === false), true);

const productWithoutBbox = {
  ...butter,
  bbox: null,
  ai_checks: butter.ai_checks ? { ...butter.ai_checks, bbox: null } : null,
};
const productReread = await rereadProductFromImage(
  { pages: pagesBackend, parser, audit },
  ctx,
  productWithoutBbox,
  pageReread.run.id,
  hooks,
);

assert.equal(parser.parserRuns.length, 3, "product re-read musí vytvořit další parser_run");
assert.ok(parser.parserRuns.some((row) => row.id === firstRunId));
assert.ok(parser.parserRuns.some((row) => row.id === pageReread.run.id));
assert.equal(productReread.audit.scope, "product");
assert.equal(productReread.audit.previous_run_id, pageReread.run.id);
assert.equal(productReread.audit.new_run_id, productReread.run.id);
assert.equal(productReread.offers.length, 1);
assert.equal(productReread.offers[0]?.extracted_name, "Máslo 250 g");
assert.ok(pass2Crops.length >= 3);
assert.ok(pass2Images.every((n) => n > 0));

const stillHuman = parser.staging.find((row) => row.id === yog.id)!;
assert.equal(stillHuman.extracted_name, "Ruční jogurt");

console.log(JSON.stringify({
  page_reread: {
    previous_run_id: pageReread.audit.previous_run_id,
    new_run_id: pageReread.audit.new_run_id,
    parser_version: pageReread.audit.parser_version,
    adapter_version: pageReread.audit.adapter_version,
    preserved_human: stillHuman.extracted_name,
    ai_proposal: humanAfterPage.ai_proposal?.extracted_name,
  },
  product_reread: {
    previous_run_id: productReread.audit.previous_run_id,
    new_run_id: productReread.audit.new_run_id,
    runs_kept: parser.parserRuns.length,
  },
}, null, 2));

console.log("PASS leaflet reread: page + product from original image, human fields kept, old parser_run stays");
