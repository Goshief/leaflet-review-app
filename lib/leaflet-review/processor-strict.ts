import { processLeafletPdf as processLeafletPdfLegacy } from "./processor";
import { analyzePageCompletion } from "./page-state";
import { sendLeafletNotification } from "./notify";

async function getDocument(s: any, bucket: string, path: string) {
  const { data, error } = await s
    .from("leaflet_documents")
    .select("*")
    .eq("storage_bucket", bucket)
    .eq("storage_path", path)
    .maybeSingle();
  if (error) throw new Error(`leaflet document lookup: ${error.message}`);
  return data ?? null;
}

async function getPageStates(s: any, leafletId: string) {
  const { data, error } = await s
    .from("leaflet_page_processing")
    .select("page_no,status,attempt_count,processing_error")
    .eq("leaflet_id", leafletId)
    .order("page_no");
  if (error) throw new Error(`page state: ${error.message}`);
  return data ?? [];
}

async function getCandidateCounts(s: any, leafletId: string) {
  const { data, error } = await s.from("leaflet_item_candidates").select("status").eq("leaflet_id", leafletId);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const count = (status: string) => rows.filter((row: any) => row.status === status).length;
  const unreviewed = count("unreviewed") + count("needs_reread");
  return {
    candidate_count: rows.length,
    unreviewed_count: unreviewed,
    approved_count: count("approved"),
    rejected_count: count("rejected"),
    quarantine_count: count("quarantine"),
  };
}

async function queueNotification(s: any, leaflet: any, counts: any) {
  const subject = `${String(leaflet.retailer_id).toUpperCase()} – nový leták ke kontrole`;
  const waiting = counts.unreviewed_count + counts.quarantine_count;
  const body = `Na ${String(leaflet.retailer_id).toUpperCase()} je nový leták. Zpracováno ${leaflet.page_count} stran, nalezeno ${counts.candidate_count} položek, ${waiting} čeká na kontrolu.`;
  const { error } = await s.from("leaflet_notification_outbox").upsert(
    { leaflet_id: leaflet.id, subject, body_text: body, status: "pending" },
    { onConflict: "leaflet_id,channel" },
  );
  if (error) throw new Error(`notification outbox: ${error.message}`);
  await s.from("leaflet_documents").update({ notification_status: "queued" }).eq("id", leaflet.id);
  return sendLeafletNotification(s, leaflet.id);
}

export async function processLeafletPdf(args: {
  supabase: any;
  bucket: string;
  path: string;
  retailer: string;
  sourceUrl: string | null;
  bytes?: Uint8Array;
  page?: number | null;
  force?: boolean;
  failPageForTest?: number | null;
}) {
  if (args.page != null) return processLeafletPdfLegacy(args);

  const s = args.supabase;
  let document = await getDocument(s, args.bucket, args.path);
  let lastResult: any = null;

  // A new document must be initialized through the existing processor, but only one
  // page at a time so the legacy processed_pages >= page_count finalizer cannot send
  // a notification before we validate the exact page-state invariant.
  if (!document) {
    lastResult = await processLeafletPdfLegacy({ ...args, page: 1 });
    document = await getDocument(s, args.bucket, args.path);
    if (!document) throw new Error("Leaflet document nebyl po inicializaci nalezen.");
  }

  const pageCount = Number(document.page_count || lastResult?.leaflet?.page_count || 0);
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("Dokument nemá platný page_count.");

  let states = await getPageStates(s, String(document.id));
  const pages = args.force
    ? Array.from({ length: pageCount }, (_, i) => i + 1)
    : states.filter((row: any) => row.status !== "completed").map((row: any) => Number(row.page_no));

  for (const pageNo of pages) {
    // Page 1 of a new document was already processed during initialization.
    if (!args.force && lastResult && pageNo === 1) continue;
    lastResult = await processLeafletPdfLegacy({ ...args, page: pageNo });
  }

  document = await getDocument(s, args.bucket, args.path);
  if (!document) throw new Error("Leaflet document po zpracování neexistuje.");
  states = await getPageStates(s, String(document.id));
  const completion = analyzePageCompletion(states, pageCount);
  const counts = await getCandidateCounts(s, String(document.id));

  if (!completion.isComplete) {
    const failed = states.find((row: any) => row.status === "failed");
    const diagnostics = {
      missing_pages: completion.missingPages,
      duplicate_pages: completion.duplicatePages,
      out_of_range_pages: completion.outOfRangePages,
      unfinished_pages: completion.unfinishedPages,
    };
    const processingError = failed?.processing_error
      ? `Strana ${failed.page_no}: ${String(failed.processing_error)}`
      : `PAGE_COMPLETION_INVARIANT: ${JSON.stringify(diagnostics)}`;
    const processingStatus = failed ? "failed" : "processing";
    const { error } = await s.from("leaflet_documents").update({
      processed_pages: completion.completedCount,
      processing_status: processingStatus,
      processing_completed_at: null,
      processing_error: processingError.slice(0, 2000),
      updated_at: new Date().toISOString(),
      ...counts,
    }).eq("id", document.id);
    if (error) throw new Error(`strict finalization: ${error.message}`);

    return {
      ...(lastResult ?? {}),
      leaflet: {
        ...(lastResult?.leaflet ?? document),
        ...counts,
        processed_pages: completion.completedCount,
        processing_status: processingStatus,
        processing_error: processingError.slice(0, 2000),
      },
      page_completion: completion,
      notification: null,
    };
  }

  const processingStatus = counts.unreviewed_count + counts.quarantine_count > 0 ? "ready_for_review" : "completed";
  const completedAt = new Date().toISOString();
  const { error: updateError } = await s.from("leaflet_documents").update({
    page_count: pageCount,
    processed_pages: completion.completedCount,
    processing_status: processingStatus,
    processing_completed_at: completedAt,
    processing_error: null,
    updated_at: completedAt,
    ...counts,
  }).eq("id", document.id);
  if (updateError) throw new Error(`strict finalization: ${updateError.message}`);

  const finalLeaflet = {
    ...(lastResult?.leaflet ?? document),
    ...counts,
    page_count: pageCount,
    processed_pages: completion.completedCount,
    processing_status: processingStatus,
    processing_completed_at: completedAt,
    processing_error: null,
  };
  const notification = await queueNotification(s, finalLeaflet, counts);
  const { data: candidates } = await s
    .from("leaflet_item_candidates")
    .select("*")
    .eq("leaflet_id", document.id)
    .order("page_no")
    .limit(20);

  return {
    ...(lastResult ?? {}),
    leaflet: finalLeaflet,
    candidates: candidates ?? [],
    page_completion: completion,
    notification,
  };
}
