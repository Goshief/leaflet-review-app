import { NextResponse } from "next/server";
import { runGenericLeafletConnector } from "@/lib/leaflet-monitor/generic-fetcher";
import { captureCurrentLeafletOrigin } from "@/lib/leaflet-monitor/origin-capture";
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
    return NextResponse.json({ ...payload, origin });
  } catch (error) {
    return NextResponse.json({
      ...payload,
      ok: false,
      origin_error: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
