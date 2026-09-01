import assert from "node:assert/strict";
import {
  createMemoryPdfIntakeBackend,
  ingestOriginalPdf,
  originalPdfStoragePath,
} from "../lib/leaflet-monitor/pdf-intake.ts";
import {
  createMemoryPdfPagesBackend,
  ensurePagesAfterDownload,
  pageImageStoragePath,
} from "../lib/leaflet-monitor/pdf-pages.ts";
import { countPdfPages, renderPdfPagesToPng } from "../lib/pdf/render-pages-node.ts";

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

const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const pdf = makeMinimalPdf(3);
assert.equal(await countPdfPages(pdf), 3);

{
  const intake = createMemoryPdfIntakeBackend();
  const pagesBackend = createMemoryPdfPagesBackend(intake.rows, intake.files);
  const archive = await ingestOriginalPdf(intake, {
    store_id: "billa",
    source_url: "https://www.billa.cz/letaky-billa/velky-letak",
    pdf_source_url: "https://cdn.example/letak-3p.pdf",
    bytes: pdf,
    content_type: "application/pdf",
    valid_from: "2026-08-05",
    downloaded_at: "2026-09-01T12:00:00.000Z",
  });
  const split = await ensurePagesAfterDownload(pagesBackend, archive, pdf, renderPdfPagesToPng);

  assert.equal(split.batch_status, "pages_ready");
  assert.equal(split.pages.length, 3);
  assert.equal(intake.rows[0]?.status, "pages_ready");

  for (let i = 0; i < 3; i++) {
    const page = split.pages[i]!;
    assert.equal(page.batch_id, archive.batch_id);
    assert.equal(page.store_id, "billa");
    assert.equal(page.page_no, i + 1);
    assert.ok(page.page_id);
    assert.notEqual(page.page_id, page.batch_id);
    assert.equal(page.image_storage_path, pageImageStoragePath("billa", 2026, archive.batch_id, i + 1));
    assert.match(page.image_storage_path, new RegExp(`/pages/00${i + 1}\\.png$`));
    assert.ok(page.width > 0);
    assert.ok(page.height > 0);
    assert.ok(page.rendered_at);
    assert.equal(page.processing_status, "rendered");
    const png = intake.files.get(page.image_storage_path);
    assert.ok(png);
    assert.ok(Buffer.from(png).subarray(0, 4).equals(pngMagic));
  }

  assert.ok(intake.files.has(originalPdfStoragePath("billa", 2026, archive.batch_id)));

  const again = await ensurePagesAfterDownload(pagesBackend, { ...archive, status: "pages_ready", created_import: false, storage_overwritten: false }, pdf, renderPdfPagesToPng);
  assert.equal(again.pages.length, 3);
  assert.equal(pagesBackend.pages.length, 3);

  const otherIntake = createMemoryPdfIntakeBackend();
  const otherPages = createMemoryPdfPagesBackend(otherIntake.rows, otherIntake.files);
  const otherPdf = makeMinimalPdf(2);
  const otherArchive = await ingestOriginalPdf(otherIntake, {
    store_id: "lidl",
    source_url: "https://www.lidl.cz/",
    pdf_source_url: "https://cdn.example/lidl.pdf",
    bytes: otherPdf,
    content_type: "application/pdf",
  });
  const otherSplit = await ensurePagesAfterDownload(otherPages, otherArchive, otherPdf, renderPdfPagesToPng);
  assert.equal(otherSplit.pages.length, 2);
  assert.equal(otherSplit.pages.every((page) => page.batch_id === otherArchive.batch_id), true);
  assert.equal(split.pages.some((page) => page.batch_id === otherArchive.batch_id), false);
  assert.equal(pagesBackend.pages.some((page) => page.batch_id === otherArchive.batch_id), false);

  console.log(JSON.stringify({
    created_pages: split.pages.length,
    example_page: split.pages[0],
  }, null, 2));
}

console.log("PASS leaflet PDF pages: 3-page PDF split, stored, isolated by batch_id");
