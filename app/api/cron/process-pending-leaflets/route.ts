import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { processLeafletPdf } from "@/lib/leaflet-review/processor";
import { selectNextPendingLeaflet } from "@/lib/leaflet-review/processing-queue";
import { todayPrague } from "@/lib/leaflet-monitor/public-catalog";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "cron_secret_missing" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "supabase_missing" }, { status: 503 });

  const today = todayPrague();
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: documents, error } = await supabase
    .from("leaflet_documents")
    .select("id,retailer_id,storage_bucket,storage_path,source_url,valid_to,processing_status,updated_at,created_at")
    .eq("storage_bucket", "leaflet-intake")
    .gte("valid_to", today)
    .in("processing_status", ["downloaded", "processing"])
    .order("valid_to", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) return NextResponse.json({ ok: false, error: "pending_leaflets_query_failed" }, { status: 502 });

  const leaflet = selectNextPendingLeaflet(documents ?? [], today, staleBefore);
  if (!leaflet) return NextResponse.json({ ok: true, processed: false, reason: "no_pending_current_pdf", today });

  try {
    const result = await processLeafletPdf({
      supabase,
      bucket: leaflet.storage_bucket,
      path: leaflet.storage_path,
      retailer: leaflet.retailer_id,
      sourceUrl: leaflet.source_url,
      force: false,
    });
    return NextResponse.json({
      ok: true,
      processed: true,
      leaflet_id: leaflet.id,
      retailer: leaflet.retailer_id,
      processing_status: result.leaflet.processing_status,
      page_count: result.leaflet.page_count,
      processed_pages: result.leaflet.processed_pages,
      candidate_count: result.leaflet.candidate_count,
      unreviewed_count: result.leaflet.unreviewed_count,
    });
  } catch (error) {
    console.error("[process-pending-leaflets] failed", error);
    return NextResponse.json({
      ok: false,
      processed: true,
      leaflet_id: leaflet.id,
      error: error instanceof Error ? error.message : "leaflet_processing_failed",
    }, { status: 502 });
  }
}
