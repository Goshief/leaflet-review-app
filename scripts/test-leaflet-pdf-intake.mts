import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createMemoryPdfIntakeBackend,
  downloadAndArchivePdf,
  ingestOriginalPdf,
  isOriginalPdf,
  originalPdfStoragePath,
  sha256Hex,
} from "../lib/leaflet-monitor/pdf-intake.ts";

const original = new TextEncoder().encode("%PDF-1.4\n% original leaflet bytes\n");
const otherPdf = new TextEncoder().encode("%PDF-1.4\n% different leaflet\n");
const html = new TextEncoder().encode("<html>not a pdf</html>");

function mockFetch(url: string): Promise<Response> {
  if (url.includes("down")) {
    return Promise.resolve(new Response("unavailable", { status: 503, headers: { "content-type": "text/plain" } }));
  }
  if (url.includes("html")) {
    return Promise.resolve(new Response(html, { status: 200, headers: { "content-type": "text/html" } }));
  }
  const body = url.includes("other") ? otherPdf : original;
  return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/pdf" } }));
}

{
  assert.equal(isOriginalPdf(original, "application/octet-stream"), true);
  assert.equal(isOriginalPdf(html, "text/html"), false);
  assert.equal(originalPdfStoragePath("billa", 2026, "batch-1"), "leaflets/billa/2026/batch-1/original.pdf");
}

{
  const backend = createMemoryPdfIntakeBackend();
  const first = await downloadAndArchivePdf(backend, {
    store_id: "billa",
    source_url: "https://www.billa.cz/letaky-billa/velky-letak",
    pdf_source_url: "https://cdn.example/letak-a.pdf",
    valid_from: "2026-08-05",
    valid_to: "2026-08-11",
    fetchImpl: mockFetch as unknown as typeof fetch,
  });

  assert.equal(first.status, "downloaded");
  assert.equal(first.created_import, true);
  assert.equal(first.store_id, "billa");
  assert.equal(first.source_url, "https://www.billa.cz/letaky-billa/velky-letak");
  assert.equal(first.pdf_source_url, "https://cdn.example/letak-a.pdf");
  assert.ok(first.batch_id);
  assert.equal(first.pdf_storage_path, originalPdfStoragePath("billa", 2026, first.batch_id));
  assert.equal(first.pdf_sha256, sha256Hex(original));
  assert.equal(first.pdf_size_bytes, original.byteLength);
  assert.ok(first.downloaded_at);
  assert.equal(first.valid_from, "2026-08-05");
  assert.equal(first.valid_to, "2026-08-11");
  assert.equal(first.storage_overwritten, false);

  const stored = await backend.getOriginal(first.pdf_storage_path!);
  assert.ok(stored);
  assert.equal(sha256Hex(stored), first.pdf_sha256);
  assert.deepEqual(stored, original);

  const duplicate = await downloadAndArchivePdf(backend, {
    store_id: "billa",
    source_url: "https://www.billa.cz/letaky-billa/velky-letak",
    pdf_source_url: "https://cdn.example/letak-a-renamed.pdf",
    fetchImpl: mockFetch as unknown as typeof fetch,
  });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.created_import, false);
  assert.equal(duplicate.batch_id, first.batch_id);
  assert.equal(duplicate.pdf_sha256, first.pdf_sha256);
  assert.equal(backend.rows.filter((row) => row.status === "downloaded").length, 1);
  assert.equal(backend.files.size, 1);

  const secondBytes = new TextEncoder().encode("%PDF-1.4 overwrite attempt");
  const again = await backend.putOriginal(first.pdf_storage_path!, secondBytes);
  assert.equal(again.written, false);
  assert.equal(again.existed, true);
  assert.deepEqual(await backend.getOriginal(first.pdf_storage_path!), original);
}

{
  const backend = createMemoryPdfIntakeBackend();
  const failed = await downloadAndArchivePdf(backend, {
    store_id: "lidl",
    source_url: "https://www.lidl.cz/",
    pdf_source_url: "https://cdn.example/down.pdf",
    fetchImpl: mockFetch as unknown as typeof fetch,
  });
  assert.equal(failed.status, "download_failed");
  assert.equal(failed.created_import, false);
  assert.equal(failed.pdf_source_url, "https://cdn.example/down.pdf");
  assert.equal(failed.source_url, "https://www.lidl.cz/");
  assert.equal(failed.pdf_storage_path, null);
  assert.equal(failed.pdf_sha256, null);
  assert.ok(failed.error_message);
  assert.equal(backend.files.size, 0);

  const notPdf = await downloadAndArchivePdf(backend, {
    store_id: "lidl",
    source_url: "https://www.lidl.cz/",
    pdf_source_url: "https://cdn.example/html",
    fetchImpl: mockFetch as unknown as typeof fetch,
  });
  assert.equal(notPdf.status, "download_failed");
  assert.equal(notPdf.pdf_source_url, "https://cdn.example/html");
  assert.equal(backend.files.size, 0);

  const recovered = await ingestOriginalPdf(backend, {
    store_id: "lidl",
    source_url: "https://www.lidl.cz/",
    pdf_source_url: "https://cdn.example/down.pdf",
    bytes: original,
    content_type: "application/pdf",
  });
  assert.equal(recovered.status, "downloaded");
  assert.equal(recovered.batch_id, failed.batch_id);
  assert.equal(recovered.pdf_sha256, createHash("sha256").update(original).digest("hex"));
  assert.match(recovered.pdf_storage_path || "", /^leaflets\/lidl\/\d{4}\/.+\/original\.pdf$/);
}

console.log("PASS leaflet PDF intake: URL → download → storage → DB metadata → hash, duplicates and download_failed");
