import { NextResponse } from "next/server";
import { runLeafletConnectorWithOrigin } from "@/lib/leaflet-monitor/connector-with-origin";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { processLeafletPdf } from "@/lib/leaflet-review/processor";

export const runtime = "nodejs";
export const maxDuration = 300;

const retailer = getRetailerConfig("billa");

export async function GET(req: Request) {
  const url = new URL(req.url);
  const manual = url.searchParams.get("manual") === "1";
  const reprocess = manual && url.searchParams.get("reprocess") === "1";

  // A manual reprocess is not a new download. Re-use the oldest document for the
  // newest validity window so approved/rejected/manual review state stays attached
  // to the same leaflet and learning statistics are not polluted by a fake download.
  if (reprocess) {
    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });
    const { data: docs, error } = await supabase
      .from("leaflet_documents")
      .select("*")
      .eq("retailer_id", "billa")
      .not("valid_to", "is", null)
      .order("valid_to", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const currentValidTo = docs?.[0]?.valid_to ?? null;
    const canonical = (docs ?? []).find((d: any) => d.valid_to === currentValidTo) ?? docs?.[0];
    if (!canonical?.storage_path) return NextResponse.json({ ok: false, error: "Kanonický BILLA leták nebyl nalezen." }, { status: 404 });
    try {
      const processing = await processLeafletPdf({
        supabase,
        bucket: canonical.storage_bucket || "leaflet-intake",
        path: canonical.storage_path,
        retailer: "billa",
        sourceUrl: canonical.source_url ?? retailer.fetch_url,
        force: true,
      });
      return NextResponse.json({
        ok: true,
        retailer: "billa",
        status: "reprocessed",
        manual: true,
        storage_path: canonical.storage_path,
        leaflet_id: canonical.id,
        processing,
      });
    } catch (err) {
      return NextResponse.json({ ok: false, retailer: "billa", status: "error", error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  return runLeafletConnectorWithOrigin(req, {
    retailer: retailer.id,
    sourcePage: retailer.fetch_url,
    cronSchedule: "29 7 * * *",
    preferredLabels: [/Velký leták/i, /Stáhnout PDF/i, /aktuální leták/i],
    autoProcess: true,
  });
}
