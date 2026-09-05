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

type PublishedAsset = {
  storagePath: string;
  sha256: string | null;
  pdfUrl: string | null;
  validFrom: string | null;
  validTo: string | null;
};

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function assetFromRow(row: Record<string, unknown>): PublishedAsset | null {
  const storagePath = asString(row.storage_path);
  if (!storagePath) return null;
  const identity = row.identity && typeof row.identity === "object" ? row.identity as Record<string, unknown> : {};
  return {
    storagePath,
    sha256: asString(row.sha256),
    pdfUrl: asString(row.pdf_url),
    validFrom: asString(identity.valid_from) ?? asString(row.valid_from),
    validTo: asString(identity.valid_to) ?? asString(row.valid_to),
  };
}

function publishedAssets(payload: Record<string, unknown>) {
  const out: PublishedAsset[] = [];
  const seen = new Set<string>();
  const add = (asset: PublishedAsset | null) => {
    if (!asset || seen.has(asset.storagePath)) return;
    seen.add(asset.storagePath);
    out.push(asset);
  };
  add(assetFromRow(payload));
  if (Array.isArray(payload.leaflets)) {
    for (const row of payload.leaflets) {
      if (row && typeof row === "object") add(assetFromRow(row as Record<string, unknown>));
    }
  }
  return out;
}

async function publishOne(retailer: string, asset: PublishedAsset) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { published: false, reason: "supabase_missing", storage_path: asset.storagePath };

  if (retailer === "albert") {
    const { data: existing } = await supabase
      .from("leaflet_documents")
      .select("id")
      .eq("storage_bucket", "leaflet-intake")
      .eq("storage_path", asset.storagePath)
      .maybeSingle();
    if (!existing?.id) {
      await processLeafletPdf({
        supabase,
        bucket: "leaflet-intake",
        path: asset.storagePath,
        retailer,
        sourceUrl: asset.pdfUrl,
        force: false,
      });
    }
  }

  const update: Record<string, unknown> = {};
  if (asset.validFrom && asset.validTo) {
    update.valid_from = asset.validFrom;
    update.valid_to = asset.validTo;
  }

  let cover: string | null = null;
  let pageCount: number | null = null;
  if (asset.sha256) {
    const { data: intake } = await supabase
      .from("leaflet_pdf_intake")
      .select("batch_id")
      .eq("store_id", retailer)
      .eq("pdf_sha256", asset.sha256)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (intake?.batch_id) {
      const { data: pages } = await supabase
        .from("leaflet_pdf_pages")
        .select("page_no,image_storage_path")
        .eq("batch_id", intake.batch_id)
        .order("page_no", { ascending: true });
      cover = (pages ?? []).find((page: any) => Number(page.page_no) === 1)?.image_storage_path ?? null;
      pageCount = (pages ?? []).length || null;
      if (cover) update.cover_storage_path = cover;
      if (pageCount) update.page_count = pageCount;
    }
  }

  if (Object.keys(update).length) {
    await supabase
      .from("leaflet_documents")
      .update(update)
      .eq("retailer_id", retailer)
      .eq("storage_bucket", "leaflet-intake")
      .eq("storage_path", asset.storagePath);
  }

  return {
    published: true,
    storage_path: asset.storagePath,
    cover: Boolean(cover),
    page_count: pageCount,
    valid_from: asset.validFrom,
    valid_to: asset.validTo,
  };
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
    const assets = publishedAssets(payload);
    const publication = [];
    for (const asset of assets) publication.push(await publishOne(retailer, asset));
    return NextResponse.json({ ...payload, publication });
  } catch (error) {
    return NextResponse.json({
      ...payload,
      ok: false,
      publication_error: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
