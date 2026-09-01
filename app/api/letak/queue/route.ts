import { NextRequest, NextResponse } from "next/server";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabasePageParserBackend, type StagingOfferRecord } from "@/lib/leaflet-monitor/page-parser";
import type { PdfIntakeRecord } from "@/lib/leaflet-monitor/pdf-intake";
import type { PdfPageRecord } from "@/lib/leaflet-monitor/pdf-pages";
import {
  leafletsFromParts,
  nextReviewPage,
  persistHumanApprovals,
  persistHumanFieldEdits,
  uniquePagePointers,
  type ReviewQueuePage,
} from "@/lib/leaflet-monitor/review-queue";

export const runtime = "nodejs";

export async function loadQueuePage(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<ReviewQueuePage | null> {
  if (!supabase) return null;
  const { data: pending, error } = await supabase
    .from("offers_staging")
    .select("batch_id,page_id,page_no,store_id,review_status")
    .in("review_status", ["pending", "needs_review"]);
  if (error) throw new Error(error.message);
  const rows = pending ?? [];
  if (!rows.length) return null;
  const batchIds = [...new Set(rows.map((row) => String(row.batch_id)))];
  const { data: intakes, error: intakeError } = await supabase
    .from("leaflet_pdf_intake")
    .select("batch_id,store_id,downloaded_at,pdf_storage_path,status")
    .in("batch_id", batchIds);
  if (intakeError) throw new Error(intakeError.message);
  const pointers = uniquePagePointers(
    rows.map((row) => ({
      batch_id: String(row.batch_id),
      page_id: String(row.page_id || ""),
      page_no: Number(row.page_no),
      store_id: String(row.store_id || ""),
    })),
    (intakes ?? []).map((row) => ({
      batch_id: String(row.batch_id),
      store_id: String(row.store_id || ""),
      downloaded_at: row.downloaded_at,
    })),
  );
  if (!pointers[0]) return null;

  const { data: pages, error: pagesError } = await supabase
    .from("leaflet_pdf_pages")
    .select("page_id,batch_id,store_id,page_no,image_storage_path,width,height,rendered_at,processing_status")
    .in("batch_id", batchIds);
  if (pagesError) throw new Error(pagesError.message);

  const parser = createSupabasePageParserBackend(supabase);
  const staging: StagingOfferRecord[] = [];
  for (const pageId of new Set((pages ?? []).map((row) => String(row.page_id)))) {
    staging.push(...(await parser.listStagingByPage(pageId)));
  }

  const intakeRows: PdfIntakeRecord[] = (intakes ?? []).map((row) => ({
    batch_id: String(row.batch_id),
    store_id: String(row.store_id),
    source_url: null,
    pdf_source_url: null,
    pdf_storage_path: row.pdf_storage_path ?? null,
    pdf_sha256: null,
    pdf_size_bytes: null,
    downloaded_at: row.downloaded_at ?? null,
    valid_from: null,
    valid_to: null,
    status: "pages_ready",
  }));
  const pageRows: PdfPageRecord[] = (pages ?? []).map((row) => ({
    page_id: String(row.page_id),
    batch_id: String(row.batch_id),
    store_id: String(row.store_id),
    page_no: Number(row.page_no),
    image_storage_path: String(row.image_storage_path),
    width: Number(row.width || 0),
    height: Number(row.height || 0),
    rendered_at: String(row.rendered_at || ""),
    processing_status: "parsed",
  }));
  return nextReviewPage(leafletsFromParts(intakeRows, pageRows, staging));
}

export function publicQueueItem(page: ReviewQueuePage | null) {
  if (!page) return null;
  return {
    batch_id: page.batch_id,
    page_id: page.page_id,
    page_no: page.page_no,
    store_id: page.store_id,
    downloaded_at: page.downloaded_at,
    remaining_pages_in_batch: page.remaining_pages_in_batch,
    remaining_pages: page.remaining_pages,
    remaining_leaflets: page.remaining_leaflets,
    image_url: `/api/letak/page-image?page_id=${encodeURIComponent(page.page_id)}`,
    offers: page.offers,
  };
}

export async function GET() {
  const requestId = makeRequestId();
  const gate = await requireOperatorApi({ requestId });
  if (!gate.ok) return gate.response;
  try {
    const page = await loadQueuePage(getSupabaseAdmin());
    return NextResponse.json({ ok: true, empty: !page, item: publicQueueItem(page) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      safeErrorJson({ status: 500, code: "INTERNAL_ERROR", message, requestId, cause: error }),
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = makeRequestId();
  const gate = await requireOperatorApi({ requestId });
  if (!gate.ok) return gate.response;
  try {
    const body = (await req.json().catch(() => null)) as {
      action?: string;
      page_id?: string;
      offer_id?: string;
      offers?: Array<Partial<StagingOfferRecord> & { id?: string }>;
    } | null;
    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ ok: true, empty: true, item: null, persisted: false });
    const parser = createSupabasePageParserBackend(supabase);
    const action = body?.action || "approve_page";
    const pageId = String(body?.page_id || "");
    if (!pageId) {
      return NextResponse.json(
        safeErrorJson({ status: 400, code: "BAD_REQUEST", message: "Chybí page_id.", requestId }),
        { status: 400 },
      );
    }
    if (Array.isArray(body?.offers) && body.offers.length) {
      await persistHumanFieldEdits(parser, body.offers);
    }
    const offers = await parser.listStagingByPage(pageId);
    if (action === "reject_offer" && body?.offer_id) {
      await parser.updateStaging(body.offer_id, {
        review_status: "rejected",
        reviewed_at: new Date().toISOString(),
      });
    } else {
      const ids = action === "approve_offer" && body?.offer_id ? [body.offer_id] : null;
      await persistHumanApprovals(parser, offers, ids);
    }
    const next = await loadQueuePage(supabase);
    return NextResponse.json({ ok: true, empty: !next, item: publicQueueItem(next) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      safeErrorJson({ status: 500, code: "INTERNAL_ERROR", message, requestId, cause: error }),
      { status: 500 },
    );
  }
}