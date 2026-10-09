import { renderPdfCover } from "../pdf/render-pages-node.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allowedCatalogDocument, boundedBytes, readCatalogSource, MAX_CATALOG_PDF_BYTES, type CatalogResult } from "./public-catalog.ts";

export type CatalogPublication = { published: number; downloaded: number; errors: string[] };
/** Publishes the browsable document independently of OCR/product approval. */
export async function publishPublicCatalog(client: SupabaseClient, result: CatalogResult, fetchImpl: typeof fetch = fetch, renderCover: typeof renderPdfCover = renderPdfCover): Promise<CatalogPublication> {
  const outcome: CatalogPublication = { published: 0, downloaded: 0, errors: [...result.errors] };
  for (const leaflet of result.leaflets) {
    try {
      if (!allowedCatalogDocument(leaflet.retailerId,leaflet.sourceUrl,leaflet.kind)) throw new Error("untrusted_document");
      const {data: existing, error: lookupError} = await client.from("leaflet_documents").select("id,storage_path,cover_storage_path,page_count").eq("internal_leaflet_key",leaflet.internalLeafletKey).maybeSingle();
      if (lookupError) throw new Error(`document_lookup: ${lookupError.message}`);
      let storagePath = existing?.storage_path ?? leaflet.storagePath;
      let coverPath = existing?.cover_storage_path || leaflet.coverUrl;
      let pageCount = existing?.page_count ?? null;
      let pdfBytes: Uint8Array | null = null;
      // A remote fallback is retried on the next scheduled run. An archived copy is downloaded once.
      if (!existing || String(storagePath).includes("/remote-catalog-")) {
        const limit = leaflet.kind === "pdf" ? MAX_CATALOG_PDF_BYTES : 3 * 1024 * 1024;
        const bytes = await boundedBytes(await readCatalogSource(leaflet.sourceUrl,fetchImpl,limit),limit);
        if (leaflet.kind === "pdf") pdfBytes = bytes;
        if (leaflet.kind === "pdf" && new TextDecoder().decode(bytes.slice(0,5)) !== "%PDF-") throw new Error("invalid_pdf_signature");
        // The existing private bucket accepts JSON but not text/html. Preserve
        // the viewer snapshot as a JSON envelope; the public page opens the
        // official viewer and never serves this archive as executable HTML.
        const archive = leaflet.kind === "pdf" ? bytes : JSON.stringify({sourceUrl:leaflet.sourceUrl,checkedAt:result.checkedAt,html:new TextDecoder().decode(bytes)});
        const {error: storageError} = await client.storage.from("leaflet-intake").upload(leaflet.storagePath,archive,{contentType: leaflet.kind === "pdf" ? "application/pdf" : "application/json",upsert:true});
        if (storageError) {
          // Quota/size failure must be visible, while the original official document remains browsable.
          storagePath = leaflet.storagePath.replace("/catalog-","/remote-catalog-");
          outcome.errors.push(`${leaflet.retailerId}: storage_upload_failed`);
        } else { storagePath = leaflet.storagePath; outcome.downloaded++; }
      }
      if (leaflet.kind === "pdf" && (!coverPath || !pageCount)) {
        try {
          if (!pdfBytes) pdfBytes = await boundedBytes(await readCatalogSource(leaflet.sourceUrl,fetchImpl,MAX_CATALOG_PDF_BYTES),MAX_CATALOG_PDF_BYTES);
          if (new TextDecoder().decode(pdfBytes.slice(0,5)) !== "%PDF-") throw new Error("invalid_pdf_signature");
          const preview = await renderCover(pdfBytes);
          pageCount = preview.pageCount;
          if (!coverPath) {
            const path = leaflet.storagePath.replace(/\.pdf$/, ".cover.jpg");
            const {error: coverError} = await client.storage.from("leaflet-intake").upload(path,preview.jpeg,{contentType:"image/jpeg",upsert:true});
            if (coverError) throw new Error("cover_upload_failed");
            coverPath = path;
          }
        } catch { outcome.errors.push(`${leaflet.retailerId}: cover_generation_failed`); }
      }
      const row = {
        retailer_id: leaflet.retailerId, internal_leaflet_key: leaflet.internalLeafletKey,
        storage_bucket: "leaflet-intake", storage_path: storagePath, filename: leaflet.filename,
        source_url: leaflet.sourceUrl, cover_storage_path: coverPath, ...(pageCount ? {page_count:pageCount} : {}),
        valid_from: leaflet.validFrom, valid_to: leaflet.validTo,
        ...(!existing ? { processing_status: "downloaded", notification_status: "disabled" } : {}),
      };
      const {error} = existing
        ? await client.from("leaflet_documents").update(row).eq("id",existing.id)
        : await client.from("leaflet_documents").upsert(row,{onConflict:"internal_leaflet_key",ignoreDuplicates:true});
      if (error) throw new Error(`document_publish: ${error.message}`);
      outcome.published++;
    } catch (error) { outcome.errors.push(`${leaflet.retailerId}: ${error instanceof Error ? error.message : "publication_failed"}`); }
  }
  // Store a compact, inspectable result for every source, including failures/no-current-leaflet.
  const {error: logError} = await client.storage.from("leaflet-intake").upload(`_catalog-checks/${result.retailer}.json`,JSON.stringify({ ...result, leaflets: result.leaflets.map(x => ({ sourceUrl:x.sourceUrl,validFrom:x.validFrom,validTo:x.validTo })), publication:outcome }),{contentType:"application/json",upsert:true});
  if (logError) outcome.errors.push(`${result.retailer}: check_log_failed`);
  return outcome;
}
