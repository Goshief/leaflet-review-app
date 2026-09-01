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
  assertNoAutoApprove,
  leafletsFromParts,
  nextReviewPage,
  persistHumanApprovals,
  persistHumanFieldEdits,
} from "../lib/leaflet-monitor/review-queue.ts";
import { VERIFIED_PRODUCT_KEYS, type Pass3FieldDecision } from "../lib/leaflet/ai-checks.ts";
import type { LeafletProduct } from "../lib/leaflet/leaflet-product.ts";
import { renderPdfPagesToPng } from "../lib/pdf/render-pages-node.ts";

function makeMinimalPdf(pageCount: number, marker = "batch"): Uint8Array {
  const parts: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [];
  const add = (n: number, body: string) => {
    offsets[n] = parts.reduce((sum, part) => sum + part.length, 0);
    parts.push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(" ");
  add(1, "<< /Type /Catalog /Pages 2 0 R >>");
  add(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  for (let i = 0; i < pageCount; i++) {
    add(3 + i, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>");
  }
  const startxref = parts.reduce((sum, part) => sum + part.length, 0);
  const size = pageCount + 3;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  parts.push(xref);
  parts.push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n% ${marker}\n`);
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
    extracted_name: "Ukázkový produkt",
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
    raw_text_block: "Ukázkový produkt 12,90",
    ...partial,
  };
}

function decisionsFrom(product: LeafletProduct): Partial<Record<string, Pass3FieldDecision>> {
  return Object.fromEntries(VERIFIED_PRODUCT_KEYS.map((key) => [key, { value: product[key], seen: true }]));
}

function logStep(step: string, extra?: Record<string, unknown>) {
  console.log(`E2E  ${step}${extra ? `  ${JSON.stringify(extra)}` : ""}`);
}

const intake = createMemoryPdfIntakeBackend();
const pagesBackend = createMemoryPdfPagesBackend(intake.rows, intake.files);
const parser = createMemoryPageParserBackend();
const passCounts = { pass1: 0, pass2: 0, pass3: 0 };

async function ingestAndParse(input: {
  store_id: string;
  downloaded_at: string;
  pdf_source_url: string;
}) {
  const pdf = makeMinimalPdf(2, `${input.store_id}-${input.downloaded_at}`);
  logStep("CRON: nový leták", { store_id: input.store_id, downloaded_at: input.downloaded_at });
  const archive = await ingestOriginalPdf(intake, {
    store_id: input.store_id,
    source_url: `https://example/${input.store_id}`,
    pdf_source_url: input.pdf_source_url,
    bytes: pdf,
    content_type: "application/pdf",
    valid_from: "2026-08-05",
    downloaded_at: input.downloaded_at,
  });
  assert.ok(archive.pdf_storage_path?.endsWith("/original.pdf"));
  assert.equal(archive.created_import, true);
  assert.equal(archive.storage_overwritten, false);
  const stored = await intake.getOriginal(archive.pdf_storage_path!);
  assert.ok(stored && stored.byteLength === pdf.byteLength, "originální PDF uložené");

  logStep("PDF archivováno + split na stránky + AI 3 kontroly", { batch_id: archive.batch_id });
  const split = await ensurePagesAfterDownload(pagesBackend, archive, pdf, renderPdfPagesToPng, {
    onPageImage: async (ctx) => {
      const product = sampleProduct({
        store_id: ctx.page.store_id,
        page_no: ctx.page.page_no,
        extracted_name: `${ctx.page.store_id} strana ${ctx.page.page_no}`,
        raw_text_block: `${ctx.page.store_id} strana ${ctx.page.page_no} 12,90`,
      });
      await runAutomaticPageParse({ pages: pagesBackend, parser }, ctx, {
        threePass: {
          pass1: async () => {
            passCounts.pass1 += 1;
            return {
              raw: JSON.stringify([{ ...product, bbox: { x: 0, y: 0, width: 1, height: 1 } }]),
              model: "test-workflow-pass1",
            };
          },
          pass2: async (req) => {
            passCounts.pass2 += 1;
            assert.ok(req.pageImage.byteLength > 0);
            assert.ok(req.crop.byteLength > 0);
            return product;
          },
          pass3: async (req) => {
            passCounts.pass3 += 1;
            assert.ok(req.pageImage.byteLength > 0);
            assert.ok(req.crop.byteLength > 0);
            return decisionsFrom(product);
          },
        },
      });
    },
  });
  assert.equal(split.pages.length, 2);
  assert.equal(split.batch_status, "pages_ready");
  return archive;
}

logStep("1) CRON najde dva letáky (A starší, B novější)");
const older = await ingestAndParse({
  store_id: "billa",
  downloaded_at: "2026-08-01T08:00:00.000Z",
  pdf_source_url: "https://cdn.example/billa-older.pdf",
});
const newer = await ingestAndParse({
  store_id: "lidl",
  downloaded_at: "2026-09-01T12:00:00.000Z",
  pdf_source_url: "https://cdn.example/lidl-newer.pdf",
});

assert.equal(passCounts.pass1, 4, "každá stránka = PASS 1");
assert.equal(passCounts.pass2, 4, "každý produkt = PASS 2");
assert.equal(passCounts.pass3, 4, "každý produkt = PASS 3");
assert.equal(parser.staging.length, 4);
assertNoAutoApprove(parser.staging);
assert.equal(parser.staging.every((row) => row.review_status === "pending"), true);
assert.equal(
  parser.staging.some((row) => row.review_status === "approved"),
  false,
  "parser nesmí nic schválit",
);

logStep("2) Data jsou v offers_staging (pending). Člověk ještě nic nespustil.");
const leaflets = () => leafletsFromParts(intake.rows, pagesBackend.pages, parser.staging);

logStep("3) /letak default = Ke kontrole: nejnovější leták → první nezkontrolovaná stránka");
let current = nextReviewPage(leaflets());
assert.ok(current);
assert.equal(current.batch_id, newer.batch_id);
assert.equal(current.store_id, "lidl");
assert.equal(current.page_no, 1);
assert.equal(current.remaining_leaflets, 2);
assert.equal(current.remaining_pages, 4);
logStep("   otevřeno", {
  store_id: current.store_id,
  page_no: current.page_no,
  remaining_pages: current.remaining_pages,
});

{
  const sneak = parser.staging.find((row) => row.page_id === current.page_id)!;
  await persistHumanFieldEdits(parser, [
    { id: sneak.id, extracted_name: "Ruční oprava", review_status: "approved" },
  ]);
  const afterEdit = parser.staging.find((row) => row.id === sneak.id)!;
  assert.equal(afterEdit.extracted_name, "Ruční oprava");
  assert.equal(afterEdit.review_status, "pending", "úprava polí neschvaluje");
}

logStep("4) Člověk: Schválit celou stránku → další nezkontrolovaná stránka téhož letáku");
await persistHumanApprovals(parser, parser.staging.filter((row) => row.page_id === current.page_id));
current = nextReviewPage(leaflets());
assert.ok(current);
assert.equal(current.batch_id, newer.batch_id);
assert.equal(current.page_no, 2);
logStep("   otevřeno", { store_id: current.store_id, page_no: current.page_no });

logStep("5) Poslední stránka novějšího letáku → automaticky další nový leták");
await persistHumanApprovals(parser, parser.staging.filter((row) => row.page_id === current.page_id));
current = nextReviewPage(leaflets());
assert.ok(current);
assert.equal(current.batch_id, older.batch_id);
assert.equal(current.store_id, "billa");
assert.equal(current.page_no, 1);
assert.equal(current.remaining_leaflets, 1);
logStep("   otevřeno", { store_id: current.store_id, page_no: current.page_no });

logStep("6) Schválit zbývající stránky staršího letáku");
await persistHumanApprovals(parser, parser.staging.filter((row) => row.page_id === current.page_id));
current = nextReviewPage(leaflets());
assert.ok(current);
assert.equal(current.batch_id, older.batch_id);
assert.equal(current.page_no, 2);
await persistHumanApprovals(parser, parser.staging.filter((row) => row.page_id === current.page_id));
current = nextReviewPage(leaflets());
assert.equal(current, null);
logStep("   fronta prázdná");

assert.equal(parser.staging.filter((row) => row.review_status === "approved").length, 4);
assert.equal(parser.staging.every((row) => row.reviewed_at), true);
assert.equal(parser.parserRuns.every((run) => run.status === "parsed"), true);

logStep("7) Nic se neschválilo samo — jen lidské persistHumanApprovals");
console.log(
  JSON.stringify(
    {
      original_pdfs: intake.rows.map((row) => row.pdf_storage_path),
      pages: pagesBackend.pages.length,
      pass1: passCounts.pass1,
      pass2: passCounts.pass2,
      pass3: passCounts.pass3,
      staging: parser.staging.length,
      approved_by_human: parser.staging.filter((row) => row.review_status === "approved").length,
      auto_approved: 0,
      queue_empty: true,
    },
    null,
    2,
  ),
);
console.log("PASS leaflet review workflow: CRON→PDF→stránky→3-pass→staging→Ke kontrole→Schválit→další strana/leták");
