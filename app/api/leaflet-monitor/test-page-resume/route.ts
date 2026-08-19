import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { processLeafletPdf } from "@/lib/leaflet-review/processor";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUCKET = "leaflet-intake";
const SOURCE_PATH = "billa/billa-2026-08-19__a7a0e1fef9b45d3b.pdf";
const RESULT_PATH = "_tests/results/page-resume-latest.json";
const FAIL_PAGE = 3;

async function pageSnapshot(s: any, leafletId: string) {
  const { data: pages, error } = await s.from("leaflet_page_processing").select("page_no,status,attempt_count,processing_error,started_at,completed_at").eq("leaflet_id", leafletId).order("page_no");
  if (error) throw new Error(error.message);
  const { data: doc, error: de } = await s.from("leaflet_documents").select("id,page_count,processed_pages,processing_status,processing_error").eq("id", leafletId).single();
  if (de) throw new Error(de.message);
  return { doc, pages: pages ?? [] };
}

async function cleanup(s: any, leafletId: string | null, importId: string | null) {
  if (!leafletId) return;
  const { data: candidates } = await s.from("leaflet_item_candidates").select("id").eq("leaflet_id", leafletId);
  const ids = (candidates ?? []).map((x: any) => x.id).filter(Boolean);
  if (ids.length) await s.from("leaflet_item_review_audit").delete().in("candidate_id", ids);
  await s.from("leaflet_notification_outbox").delete().eq("leaflet_id", leafletId);
  await s.from("leaflet_item_candidates").delete().eq("leaflet_id", leafletId);
  await s.from("leaflet_page_processing").delete().eq("leaflet_id", leafletId);
  await s.from("leaflet_documents").delete().eq("id", leafletId);
  if (importId) await s.from("imports").delete().eq("id", importId);
}

async function saveResult(s: any, result: unknown) {
  const body = JSON.stringify({ generated_at: new Date().toISOString(), ...result as Record<string, unknown> }, null, 2);
  const { error } = await s.storage.from(BUCKET).upload(RESULT_PATH, new Blob([body], { type: "application/json" }), { contentType: "application/json", upsert: true, cacheControl: "0" });
  if (error) throw new Error(`test result storage: ${error.message}`);
}

export async function GET(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;
  const s = getSupabaseAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });
  const readOnly = new URL(req.url).searchParams.get("read") === "1";
  if (readOnly) {
    const { data, error } = await s.storage.from(BUCKET).download(RESULT_PATH);
    if (error || !data) return NextResponse.json({ ok: false, error: error?.message || "Výsledek testu zatím neexistuje." }, { status: 404 });
    return new NextResponse(await data.text(), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  let testLeafletId: string | null = null;
  let importId: string | null = null;
  const testPath = `_tests/billa-page-resume-${Date.now()}.pdf`;
  try {
    const { data: source, error: downloadError } = await s.storage.from(BUCKET).download(SOURCE_PATH);
    if (downloadError || !source) throw new Error(downloadError?.message || "Referenční BILLA PDF nebylo nalezeno.");
    const bytes = new Uint8Array(await source.arrayBuffer());

    let injectedError: string | null = null;
    try {
      await processLeafletPdf({ supabase: s, bucket: BUCKET, path: testPath, retailer: "billa", sourceUrl: "test://page-resume/billa", bytes, failPageForTest: FAIL_PAGE });
    } catch (error) {
      injectedError = error instanceof Error ? error.message : String(error);
    }

    const { data: testDoc, error: docError } = await s.from("leaflet_documents").select("id,import_id").eq("storage_bucket", BUCKET).eq("storage_path", testPath).single();
    if (docError || !testDoc?.id) throw new Error(docError?.message || "Testovací dokument nevznikl.");
    const leafletId = String(testDoc.id);
    testLeafletId = leafletId;
    importId = typeof testDoc.import_id === "string" ? testDoc.import_id : null;

    const afterFailure = await pageSnapshot(s, leafletId);
    const failPages = afterFailure.pages.filter((x: any) => x.status === "failed");
    const completedBefore = afterFailure.pages.filter((x: any) => x.status === "completed").map((x: any) => x.page_no);

    await processLeafletPdf({ supabase: s, bucket: BUCKET, path: testPath, retailer: "billa", sourceUrl: "test://page-resume/billa", bytes });

    const afterResume = await pageSnapshot(s, leafletId);
    const page1 = afterResume.pages.find((x: any) => x.page_no === 1);
    const page2 = afterResume.pages.find((x: any) => x.page_no === 2);
    const page3 = afterResume.pages.find((x: any) => x.page_no === 3);
    const allCompleted = afterResume.pages.length === 33 && afterResume.pages.every((x: any) => x.status === "completed");
    const completedPagesWereSkipped = page1?.attempt_count === 1 && page2?.attempt_count === 1;
    const failedPageRetried = page3?.attempt_count === 2;
    const failStateVisible = injectedError === "TEST_INJECTED_PAGE_FAILURE" && failPages.length === 1 && failPages[0]?.page_no === FAIL_PAGE && afterFailure.doc.processing_status === "failed" && String(afterFailure.doc.processing_error || "").includes(`Strana ${FAIL_PAGE}`) && completedBefore.join(",") === "1,2";
    const resumeFinished = allCompleted && completedPagesWereSkipped && failedPageRetried && afterResume.doc.processed_pages === 33 && afterResume.doc.processing_error == null && ["ready_for_review", "completed"].includes(afterResume.doc.processing_status);

    const result = {
      ok: failStateVisible && resumeFinished,
      fail_page: FAIL_PAGE,
      fail_state_visible: failStateVisible,
      resume_finished: resumeFinished,
      after_failure: { document: afterFailure.doc, completed_pages: completedBefore, failed_pages: failPages },
      after_resume: { document: afterResume.doc, page1_attempts: page1?.attempt_count ?? null, page2_attempts: page2?.attempt_count ?? null, page3_attempts: page3?.attempt_count ?? null, completed_count: afterResume.pages.filter((x: any) => x.status === "completed").length },
      cleanup: "scheduled_in_finally",
    };
    await saveResult(s, result);
    return NextResponse.json(result);
  } catch (error) {
    const result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    try { await saveResult(s, result); } catch {}
    return NextResponse.json(result, { status: 500 });
  } finally {
    try { await cleanup(s, testLeafletId, importId); } catch (error) { console.error("test-page-resume cleanup failed", error); }
  }
}
