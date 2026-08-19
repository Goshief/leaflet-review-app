import { createHash } from "node:crypto";
import { resolveViewerPageManifest, validatePageManifest } from "@/lib/leaflet-monitor/page-manifest";
import { extractAllViewerCandidates } from "@/lib/leaflet-monitor/viewer-candidates";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

const BUCKET = "leaflet-intake";
const MODEL = "viewer-page-manifest-v2";

function safeIdentifier(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

async function ensureManifestStored(s: any, manifest: Awaited<ReturnType<typeof resolveViewerPageManifest>>) {
  const payload = JSON.stringify({ version: 2, ...manifest });
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const path = `${manifest.retailer}/manifests/${safeIdentifier(manifest.identifier)}__${sha256.slice(0, 16)}.json`;
  const { error } = await s.storage.from(BUCKET).upload(
    path,
    new Blob([payload], { type: "application/json" }),
    { contentType: "application/json", cacheControl: "31536000", upsert: false },
  );
  if (error && !/already exists|duplicate|resource exists/i.test(error.message || "")) {
    throw new Error(`manifest storage: ${error.message}`);
  }
  return { path, sha256 };
}

async function ensureImport(s: any, retailer: RetailerId, path: string, sourceUrl: string) {
  const key = `leaflet-staging:${BUCKET}:${path}`;
  const { data: old, error: lookupError } = await s.from("imports").select("id").eq("import_batch_key", key).maybeSingle();
  if (lookupError) throw new Error(`imports lookup: ${lookupError.message}`);
  if (old?.id) return String(old.id);

  const { data, error } = await s.from("imports").insert({
    source_type: "leaflet",
    source_url: sourceUrl,
    note: `leaflet_pages | retailer:${retailer} | storage:${BUCKET}/${path}`,
    import_batch_key: key,
    import_contract_version: "leaflet-pages-v2",
    import_contract_snapshot: { retailer, bucket: BUCKET, path, model: MODEL },
  }).select("id").single();
  if (error || !data?.id) throw new Error(error?.message || "Import manifestu nebyl vytvořen.");
  return String(data.id);
}

async function findOrCreateDocument(
  s: any,
  retailer: RetailerId,
  manifest: Awaited<ReturnType<typeof resolveViewerPageManifest>>,
  manifestPath: string,
  importId: string,
) {
  const { data: candidates, error: findError } = await s
    .from("leaflet_documents")
    .select("*")
    .eq("retailer_id", retailer)
    .eq("page_count", manifest.page_count)
    .order("created_at", { ascending: false })
    .limit(10);
  if (findError) throw new Error(`leaflet lookup: ${findError.message}`);

  const exact = (candidates ?? []).find((d: any) => d.source_url === manifest.viewer_url || d.storage_path === manifestPath);
  const pdfBacked = (candidates ?? []).find((d: any) => String(d.storage_path || "").toLowerCase().endsWith(".pdf"));
  const reusable = exact ?? pdfBacked ?? null;

  if (reusable?.id) {
    const { data, error } = await s.from("leaflet_documents").update({
      source_url: manifest.viewer_url,
      page_count: manifest.page_count,
      processing_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", reusable.id).select("*").single();
    if (error) throw new Error(`leaflet update: ${error.message}`);
    return data;
  }

  const internalKey = `${retailer}:manifest:${createHash("sha1").update(manifestPath).digest("hex")}`;
  const { data, error } = await s.from("leaflet_documents").upsert({
    retailer_id: retailer,
    storage_bucket: BUCKET,
    storage_path: manifestPath,
    filename: manifestPath.split("/").pop(),
    source_url: manifest.viewer_url,
    source_leaflet_number: manifest.identifier,
    internal_leaflet_key: internalKey,
    valid_from: null,
    valid_to: null,
    page_count: manifest.page_count,
    processed_pages: 0,
    candidate_count: 0,
    unreviewed_count: 0,
    approved_count: 0,
    rejected_count: 0,
    quarantine_count: 0,
    processing_status: "processing",
    processing_error: null,
    import_id: importId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "storage_bucket,storage_path" }).select("*").single();
  if (error || !data) throw new Error(error?.message || "Leaflet dokument manifestu nebyl vytvořen.");
  return data;
}

function sameLockedCandidate(candidate: ReturnType<typeof extractAllViewerCandidates>[number], locked: any[]) {
  const normalized = (value: unknown) => String(value ?? "").toLocaleLowerCase("cs-CZ").replace(/\s+/g, " ").trim();
  return locked.some((row) => {
    if (Number(row.price_sale) !== Number(candidate.price_sale)) return false;
    const a = normalized(row.product_name);
    const b = normalized(candidate.product_name);
    if (a && b && a === b) return true;
    const source = normalized(row.source_text);
    return Boolean(b && source.includes(b));
  });
}

async function replacePageCandidates(s: any, doc: any, page: { page_no: number; text: string; source_url: string }) {
  const extracted = extractAllViewerCandidates(page.text, page.page_no);
  const { data: existing, error: existingError } = await s
    .from("leaflet_item_candidates")
    .select("id,candidate_key,status,product_name,price_sale,source_text")
    .eq("leaflet_id", doc.id)
    .eq("page_no", page.page_no);
  if (existingError) throw new Error(`page ${page.page_no} candidate lookup: ${existingError.message}`);

  const locked = (existing ?? []).filter((row: any) => row.status === "approved" || row.status === "rejected");
  const replaceable = (existing ?? []).filter((row: any) => row.status !== "approved" && row.status !== "rejected");
  if (replaceable.length) {
    const { error: deleteError } = await s
      .from("leaflet_item_candidates")
      .delete()
      .in("id", replaceable.map((row: any) => row.id));
    if (deleteError) throw new Error(`page ${page.page_no} candidate cleanup: ${deleteError.message}`);
  }

  let written = 0;
  for (const candidate of extracted) {
    if (sameLockedCandidate(candidate, locked)) continue;
    const row = {
      leaflet_id: doc.id,
      candidate_key: candidate.candidate_key,
      page_no: candidate.page_no,
      source_bbox: null,
      source_text: candidate.source_text,
      product_name: candidate.product_name,
      brand: null,
      variant: null,
      pack_qty: null,
      pack_unit: null,
      pack_unit_qty: null,
      pack_text: null,
      price_sale: candidate.price_sale,
      price_standard: null,
      price_loyalty: null,
      price_without_loyalty: null,
      price_per_unit: null,
      price_per_unit_unit: null,
      currency: "CZK",
      leaflet_valid_from: doc.valid_from ?? null,
      leaflet_valid_to: doc.valid_to ?? null,
      item_valid_from: null,
      item_valid_to: null,
      loyalty_required: null,
      promo_label: null,
      promo_condition: null,
      minimum_quantity: null,
      field_evidence: candidate.field_evidence,
      extraction_payload: { ...candidate.extraction_payload, page_source_url: page.source_url },
      extractor_version: candidate.extractor_version,
      confidence: candidate.confidence,
      status: candidate.status,
      review_reason: candidate.review_reason,
      updated_at: new Date().toISOString(),
    };
    const { error } = await s.from("leaflet_item_candidates").upsert(row, { onConflict: "leaflet_id,candidate_key" });
    if (error) throw new Error(`page ${page.page_no} candidate: ${error.message}`);
    written++;
  }

  return { anchors: extracted.length, written, locked: locked.length };
}

async function getCounts(s: any, leafletId: string) {
  const { data, error } = await s.from("leaflet_item_candidates").select("status").eq("leaflet_id", leafletId);
  if (error) throw new Error(`candidate counts: ${error.message}`);
  const rows = data ?? [];
  const count = (status: string) => rows.filter((row: any) => row.status === status).length;
  return {
    candidate_count: rows.length,
    unreviewed_count: count("unreviewed") + count("needs_reread"),
    approved_count: count("approved"),
    rejected_count: count("rejected"),
    quarantine_count: count("quarantine"),
  };
}

export async function ingestViewerPages(s: any, retailer: RetailerId, viewerUrl: string) {
  if (!(["lidl", "kaufland", "penny"] as string[]).includes(retailer)) return null;
  const manifest = await resolveViewerPageManifest(retailer, viewerUrl);
  const validation = validatePageManifest(manifest);
  if (!validation.ok) throw new Error(`viewer manifest invalid: ${validation.errors.join("; ")}`);

  const stored = await ensureManifestStored(s, manifest);
  const importId = await ensureImport(s, retailer, stored.path, manifest.viewer_url);
  const doc = await findOrCreateDocument(s, retailer, manifest, stored.path, importId);

  const { data: existing, error: pageLookupError } = await s
    .from("leaflet_page_processing")
    .select("page_no,status,attempt_count")
    .eq("leaflet_id", doc.id)
    .order("page_no");
  if (pageLookupError) throw new Error(`page state lookup: ${pageLookupError.message}`);

  const byPage = new Map((existing ?? []).map((x: any) => [Number(x.page_no), x]));
  const missing = manifest.pages
    .filter((page) => !byPage.has(page.page_no))
    .map((page) => ({
      leaflet_id: doc.id,
      page_no: page.page_no,
      status: "pending",
      attempt_count: 0,
      source_kind: page.source_kind,
      source_url: page.source_url,
    }));
  if (missing.length) {
    const { error } = await s.from("leaflet_page_processing").insert(missing);
    if (error) throw new Error(`page state insert: ${error.message}`);
  }

  let newlyCompleted = 0;
  let extractedAnchors = 0;
  let writtenCandidates = 0;

  for (const page of manifest.pages) {
    const state = byPage.get(page.page_no) as any;
    const now = new Date().toISOString();
    const { error: startError } = await s.from("leaflet_page_processing").update({
      status: "processing",
      attempt_count: Number(state?.attempt_count || 0) + 1,
      source_kind: page.source_kind,
      source_url: page.source_url,
      processing_error: null,
      started_at: now,
      completed_at: null,
      updated_at: now,
    }).eq("leaflet_id", doc.id).eq("page_no", page.page_no);
    if (startError) throw new Error(`page ${page.page_no} start: ${startError.message}`);

    try {
      if (!page.text.trim() && !page.image_url) throw new Error("Stránka nemá použitelný text ani obrázek.");

      const candidateResult = await replacePageCandidates(s, doc, page);
      extractedAnchors += candidateResult.anchors;
      writtenCandidates += candidateResult.written;

      const hasPriceText = /\d{1,3}[,.]\d{2}/.test(page.text);
      if (hasPriceText && candidateResult.anchors === 0) {
        throw new Error("Stránka obsahuje cenové údaje, ale nevznikl žádný kandidát.");
      }

      const evidence = `${page.text}\n${page.image_url ?? ""}`;
      const doneAt = new Date().toISOString();
      const { error: doneError } = await s.from("leaflet_page_processing").update({
        status: "completed",
        source_text_hash: createHash("sha256").update(evidence).digest("hex"),
        text_length: page.text.length,
        processing_error: null,
        completed_at: doneAt,
        updated_at: doneAt,
      }).eq("leaflet_id", doc.id).eq("page_no", page.page_no);
      if (doneError) throw new Error(doneError.message);
      if (state?.status !== "completed") newlyCompleted++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await s.from("leaflet_page_processing").update({
        status: "failed",
        processing_error: message.slice(0, 2000),
        updated_at: new Date().toISOString(),
      }).eq("leaflet_id", doc.id).eq("page_no", page.page_no);
      const { count } = await s.from("leaflet_page_processing")
        .select("page_no", { count: "exact", head: true })
        .eq("leaflet_id", doc.id)
        .eq("status", "completed");
      await s.from("leaflet_documents").update({
        processing_status: "failed",
        processed_pages: Number(count || 0),
        processing_error: `Strana ${page.page_no}: ${message}`.slice(0, 2000),
        updated_at: new Date().toISOString(),
      }).eq("id", doc.id);
      throw error;
    }
  }

  const { data: pages, error: statesError } = await s
    .from("leaflet_page_processing")
    .select("page_no,status,attempt_count,processing_error")
    .eq("leaflet_id", doc.id)
    .order("page_no");
  if (statesError) throw new Error(`page state final: ${statesError.message}`);

  const completed = (pages ?? []).filter((page: any) => page.status === "completed").length;
  const failed = (pages ?? []).filter((page: any) => page.status === "failed").length;
  const counts = await getCounts(s, doc.id);
  const hasCandidates = counts.candidate_count > 0;
  const allPagesComplete = completed === manifest.page_count && failed === 0;
  const finalStatus = failed > 0
    ? "failed"
    : allPagesComplete && hasCandidates
      ? (counts.unreviewed_count + counts.quarantine_count > 0 ? "ready_for_review" : "completed")
      : "processing";
  const completedAt = allPagesComplete && hasCandidates ? new Date().toISOString() : null;

  const { data: finalDoc, error: finalError } = await s.from("leaflet_documents").update({
    page_count: manifest.page_count,
    processed_pages: completed,
    ...counts,
    processing_status: finalStatus,
    processing_error: null,
    processing_completed_at: completedAt,
    updated_at: new Date().toISOString(),
  }).eq("id", doc.id).select("*").single();
  if (finalError) throw new Error(`leaflet final: ${finalError.message}`);

  return {
    retailer,
    leaflet_id: doc.id,
    identifier: manifest.identifier,
    page_count: manifest.page_count,
    processed_pages: completed,
    failed_pages: failed,
    newly_completed: newlyCompleted,
    extracted_price_anchors: extractedAnchors,
    written_candidates: writtenCandidates,
    candidate_count: counts.candidate_count,
    processing_status: finalStatus,
    page_ingestion_complete: allPagesComplete,
    manifest_storage_path: stored.path,
    manifest_sha256: stored.sha256,
    pages: pages ?? [],
    document: finalDoc,
  };
}
