import { NextResponse } from "next/server";
import { runGenericLeafletConnector } from "@/lib/leaflet-monitor/generic-fetcher";
import { captureCurrentLeafletOrigin } from "@/lib/leaflet-monitor/origin-capture";
import { ingestViewerPages } from "@/lib/leaflet-monitor/viewer-processing";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

type ConnectorConfig = {
  retailer: RetailerId;
  sourcePage: string;
  cronSchedule: string;
  preferredLabels: RegExp[];
  autoProcess?: boolean;
};

const CAPTURE_STATUSES = new Set(["downloaded", "unchanged", "asset_found"]);
const VIEWER_RETAILERS = new Set<RetailerId>(["lidl", "kaufland", "penny"]);

export async function runLeafletConnectorWithOrigin(req: Request, config: ConnectorConfig) {
  const response = await runGenericLeafletConnector(req, config);
  if (!response.ok) return response;

  let payload: Record<string, unknown>;
  try {
    payload = await response.clone().json() as Record<string, unknown>;
  } catch {
    return response;
  }

  const status = typeof payload.status === "string" ? payload.status : "";
  if (!CAPTURE_STATUSES.has(status)) return response;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ...payload, ok: false, origin_error: "Supabase není nakonfigurovaný." }, { status: 503 });
  }

  try {
    const origin = await captureCurrentLeafletOrigin(supabase, config.retailer);
    let page_processing: unknown = null;
    if (VIEWER_RETAILERS.has(config.retailer)) {
      const assetUrl = typeof payload.asset_url === "string" ? payload.asset_url : origin.asset_url;
      if (!assetUrl) throw new Error("Viewer retailer nemá asset_url pro stránkové zpracování.");
      page_processing = await ingestViewerPages(supabase, config.retailer, assetUrl);
    }
    return NextResponse.json({ ...payload, origin, page_processing });
  } catch (error) {
    return NextResponse.json({
      ...payload,
      ok: false,
      origin_error: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
