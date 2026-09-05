import { NextResponse } from "next/server";
import { runLeafletConnectorWithOrigin } from "@/lib/leaflet-monitor/connector-with-origin";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";
import { getWatcherCronSchedule, isWatchedRetailer } from "@/lib/leaflet-monitor/watcher-config";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { processLeafletPdf } from "@/lib/leaflet-review/processor";

export const runtime = "nodejs";
export const maxDuration = 300;

const LABELS: Record<string, RegExp[]> = {
  albert: [/Akční leták/i, /Supermarket leták/i, /Hypermarket leták/i, /stáhnout/i],
  dm: [/leták/i, /akce/i, /magazín/i],
  globus: [/Akční leták/i, /Stáhnout v PDF/i, /aktuální/i],
  kosik: [/leták/i, /akce/i, /nabídka/i],
  rohlik: [/leták/i, /akce/i, /nabídka/i],
  rossmann: [/Akční leták/i, /Stáhnout leták/i, /Zobrazit leták/i],
  tesco: [/Akční leták/i, /Stáhnout/i, /Prohlédnout on-line/i],
  teta: [/leták/i, /akční leták/i, /stáhnout/i],
};

async function publishCoverAndAlbertIfNeeded(retailer: string, payload: Record<string, unknown>) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { published: false, reason: "supabase_missing" };

  const storagePath = typeof payload.storage_path === "string" ? payload.storage_path : null;
  const sha256 = typeof payload.sha256 === "string" ? payload.sha256 : null;
  const pdfUrl = typeof payload.pdf_url === "string" ? payload.pdf_url : null;
  if (!storagePath) return { published: false, reason: "no_stored_pdf" };

  if (retailer === "albert") {
    const { data: existing } = await supabase
      .from("leaflet_documents")
      .select("id")
      .eq("storage_bucket", "leaflet-intake")
      .eq("storage_path", storagePath)
      .maybeSingle();
    if (!existing?.id) {
      await processLeafletPdf({
        supabase,
        bucket: "leaflet-intake",
        path: storagePath,
        retailer,
        sourceUrl: pdfUrl,
        force: false,
      });
    }
  }

  if (!sha256) return { published: true, cover: false };
  const { data: intake } = await supabase
    .from("leaflet_pdf_intake")
    .select("batch_id")
    .eq("store_id", retailer)
    .eq("pdf_sha256", sha256)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!intake?.batch_id) return { published: true, cover: false };

  const { data: pages } = await supabase
    .from("leaflet_pdf_pages")
    .select("page_no,image_storage_path")
    .eq("batch_id", intake.batch_id)
    .order("page_no", { ascending: true });
  const cover = (pages ?? []).find((page: any) => Number(page.page_no) === 1)?.image_storage_path ?? null;
  const pageCount = (pages ?? []).length || null;
  if (cover) {
    await supabase
      .from("leaflet_documents")
      .update({ cover_storage_path: cover, ...(pageCount ? { page_count: pageCount } : {}) })
      .eq("retailer_id", retailer)
      .eq("storage_bucket", "leaflet-intake")
      .eq("storage_path", storagePath);
  }
  return { published: true, cover: Boolean(cover), page_count: pageCount };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ retailer: string }> },
) {
  const { retailer: raw } = await params;
  const retailer = raw.trim().toLowerCase();
  if (!isWatchedRetailer(retailer)) {
    return NextResponse.json({ ok: false, error: "Neznámý retailer." }, { status: 404 });
  }
  if (["billa", "lidl", "kaufland", "penny"].includes(retailer)) {
    return NextResponse.json({ ok: false, error: "Tento retailer používá specializovaný cron endpoint." }, { status: 409 });
  }

  const config = getRetailerConfig(retailer);
  const response = await runLeafletConnectorWithOrigin(req, {
    retailer: config.id,
    sourcePage: config.fetch_url,
    cronSchedule: getWatcherCronSchedule(retailer),
    preferredLabels: LABELS[retailer] ?? [/leták/i, /akce/i, /stáhnout/i],
    autoProcess: true,
  });

  let payload: Record<string, unknown> = {};
  try { payload = await response.clone().json() as Record<string, unknown>; } catch {}
  if (!response.ok) return response;

  try {
    const publication = await publishCoverAndAlbertIfNeeded(retailer, payload);
    return NextResponse.json({ ...payload, publication });
  } catch (error) {
    return NextResponse.json({
      ...payload,
      ok: false,
      publication_error: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
