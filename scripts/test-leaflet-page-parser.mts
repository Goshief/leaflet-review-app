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
  isMarkdownTablePayload,
  parseLeafletProductsJson,
  type LeafletProduct,
} from "../lib/leaflet/leaflet-product.ts";
import type { LeafletPageExtractRequest } from "../lib/leaflet/extract-page-vision.ts";
import { renderPdfPagesToPng } from "../lib/pdf/render-pages-node.ts";

function makeMinimalPdf(pageCount: number): Uint8Array {
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
  parts.push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);
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
    extracted_name: "Ukázkový jogurt",
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
    raw_text_block: "Ukázkový jogurt 12,90",
    ...partial,
  };
}

{
  const ok = parseLeafletProductsJson(JSON.stringify([sampleProduct()]));
  assert.equal(ok.ok, true);

  const markdown = parseLeafletProductsJson("| název | cena |\n| --- | --- |\n| jogurt | 12 |");
  assert.equal(markdown.ok, false);
  assert.equal(isMarkdownTablePayload("| název | cena |\n| --- | --- |\n| jogurt | 12 |"), true);

  const positional = parseLeafletProductsJson(JSON.stringify([["jogurt", 12.9, "CZK"]]));
  assert.equal(positional.ok, false);
  assert.ok(!positional.ok && positional.errors.some((err) => /poziční pole/.test(err)));

  const extra = parseLeafletProductsJson(JSON.stringify([{ ...sampleProduct(), extra_col: 1 }]));
  assert.equal(extra.ok, false);
}

{
  const pdf = makeMinimalPdf(3);
  const intake = createMemoryPdfIntakeBackend();
  const pagesBackend = createMemoryPdfPagesBackend(intake.rows, intake.files);
  const parser = createMemoryPageParserBackend();
  const requests: LeafletPageExtractRequest[] = [];

  const archive = await ingestOriginalPdf(intake, {
    store_id: "billa",
    source_url: "https://www.billa.cz/letaky-billa/velky-letak",
    pdf_source_url: "https://cdn.example/letak-3p.pdf",
    bytes: pdf,
    content_type: "application/pdf",
    valid_from: "2026-08-05",
    downloaded_at: "2026-09-01T12:00:00.000Z",
  });

  const split = await ensurePagesAfterDownload(pagesBackend, archive, pdf, renderPdfPagesToPng, {
    onPageImage: async (ctx) => {
      await runAutomaticPageParse({ pages: pagesBackend, parser }, ctx, async (req) => {
        requests.push({
          ...req,
          image: req.image.slice(),
        });
        assert.equal(req.batch_id, archive.batch_id);
        assert.equal(req.page_id, ctx.page.page_id);
        assert.equal(req.page_no, ctx.page.page_no);
        assert.equal(req.store_id, "billa");
        assert.equal(req.adapter.id, "billa");
        assert.ok(req.image.byteLength > 0);
        return {
          raw: JSON.stringify([
            sampleProduct({
              store_id: req.store_id,
              page_no: req.page_no,
              extracted_name: `Strana ${req.page_no} produkt`,
            }),
          ]),
          model: "test-mock",
        };
      });
    },
  });

  assert.equal(split.batch_status, "pages_ready");
  assert.equal(split.pages.length, 3);
  assert.equal(requests.length, 3, "každá stránka = jeden parser request");
  assert.equal(new Set(requests.map((req) => req.page_id)).size, 3);
  assert.equal(new Set(requests.map((req) => req.page_no)).size, 3);
  assert.equal(parser.parserRuns.length, 3);
  assert.equal(parser.parserRuns.every((run) => run.status === "parsed"), true);
  assert.equal(parser.parserRuns.every((run) => run.adapter === "billa"), true);
  assert.equal(split.pages.every((page) => page.processing_status === "parsed"), true);
  assert.equal(parser.staging.length, 3);
  assert.equal(parser.staging.every((row) => row.review_status === "pending"), true);
  assert.equal(parser.staging.some((row) => row.review_status === "approved" as string), false);
  assert.equal(parser.staging.every((row) => row.batch_id === archive.batch_id), true);
  assert.equal(parser.importBatches.length, 1);
  assert.equal(parser.importBatches[0]?.id, archive.batch_id);

  for (let i = 0; i < 3; i++) {
    const page = split.pages[i]!;
    const staged = parser.staging.find((row) => row.page_id === page.page_id);
    assert.ok(staged);
    assert.equal(staged.page_no, i + 1);
    assert.equal(staged.store_id, "billa");
    assert.equal(staged.extracted_name, `Strana ${i + 1} produkt`);
    assert.equal(staged.source_type, "leaflet");
    assert.equal(staged.currency, "CZK");
  }

  const again = await ensurePagesAfterDownload(
    pagesBackend,
    { ...archive, status: "pages_ready", created_import: false, storage_overwritten: false },
    pdf,
    renderPdfPagesToPng,
    {
      onPageImage: async (ctx) => {
        await runAutomaticPageParse({ pages: pagesBackend, parser }, ctx, async () => {
          throw new Error("druhý automatický parse se nesmí spustit");
        });
      },
    },
  );
  assert.equal(again.pages.length, 3);
  assert.equal(requests.length, 3);
  assert.equal(parser.parserRuns.length, 3);
  assert.equal(parser.staging.length, 3);

  console.log(JSON.stringify({
    pages: split.pages.map((page) => ({ page_no: page.page_no, status: page.processing_status })),
    parser_runs: parser.parserRuns.length,
    staging: parser.staging.length,
    review_status: parser.staging.map((row) => row.review_status),
  }, null, 2));
}

{
  const pdf = makeMinimalPdf(1);
  const intake = createMemoryPdfIntakeBackend();
  const pagesBackend = createMemoryPdfPagesBackend(intake.rows, intake.files);
  const parser = createMemoryPageParserBackend();
  const archive = await ingestOriginalPdf(intake, {
    store_id: "lidl",
    source_url: "https://www.lidl.cz/",
    pdf_source_url: "https://cdn.example/bad.pdf",
    bytes: pdf,
    content_type: "application/pdf",
  });

  const split = await ensurePagesAfterDownload(pagesBackend, archive, pdf, renderPdfPagesToPng, {
    onPageImage: async (ctx) => {
      await runAutomaticPageParse({ pages: pagesBackend, parser }, ctx, async () => ({
        raw: "| produkt | cena |\n| --- | --- |\n| jogurt | 12,90 |",
        model: "test-invalid",
      }));
    },
  });

  assert.equal(split.pages[0]?.processing_status, "needs_review");
  assert.equal(parser.parserRuns[0]?.status, "needs_review");
  assert.equal(parser.staging.length, 0);
}

{
  const pdf = makeMinimalPdf(1);
  const intake = createMemoryPdfIntakeBackend();
  const pagesBackend = createMemoryPdfPagesBackend(intake.rows, intake.files);
  const parser = createMemoryPageParserBackend();
  const archive = await ingestOriginalPdf(intake, {
    store_id: "penny",
    source_url: "https://www.penny.cz/nabidky/letaky",
    pdf_source_url: "https://cdn.example/penny.pdf",
    bytes: pdf,
    content_type: "application/pdf",
  });

  const split = await ensurePagesAfterDownload(pagesBackend, archive, pdf, renderPdfPagesToPng, {
    onPageImage: async (ctx) => {
      await runAutomaticPageParse({ pages: pagesBackend, parser }, ctx, async () => ({
        raw: JSON.stringify([["jogurt", 12.9, "CZK"]]),
        model: "test-positional",
      }));
    },
  });

  assert.equal(split.pages[0]?.processing_status, "needs_review");
  assert.equal(parser.parserRuns[0]?.status, "needs_review");
  assert.equal(parser.staging.length, 0);
}

console.log("PASS leaflet page parser: PDF → pages → automatic parser → staging (pending, never approved)");
