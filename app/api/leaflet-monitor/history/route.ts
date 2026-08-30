import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const ACTIVE = ["billa", "lidl", "kaufland", "penny"];
const SUPABASE_TIMEOUT_MS = 6_000;

function unavailable() {
  return NextResponse.json(
    { ok: false, error: "Supabase je dočasně nedostupný. Data zůstávají uložená; zkus Obnovit za několik minut." },
    { status: 503, headers: { "Retry-After": "60" } },
  );
}

export async function GET() {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });

  const query = supabase
    .from("leaflet_documents")
    .select("id,retailer_id,filename,created_at,updated_at,processing_status,page_count,processed_pages,approved_count,rejected_count,quarantine_count,unreviewed_count,candidate_count,valid_from,valid_to,notification_status")
    .in("retailer_id", ACTIVE)
    .order("created_at", { ascending: false })
    .limit(200);

  let result: Awaited<typeof query>;
  try {
    result = await Promise.race([
      query,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SUPABASE_TIMEOUT")), SUPABASE_TIMEOUT_MS)),
    ]);
  } catch {
    return unavailable();
  }
  if (result.error) return unavailable();

  const items = (result.data ?? []).map((d: any) => ({
    id: d.id, retailer: d.retailer_id, pdf: d.filename, created_at: d.created_at, updated_at: d.updated_at,
    status: d.processing_status, page_count: d.page_count, processed_pages: d.processed_pages,
    approved_count: d.approved_count, rejected_count: d.rejected_count, quarantine_count: d.quarantine_count,
    unreviewed_count: d.unreviewed_count, candidate_count: d.candidate_count, valid_from: d.valid_from,
    valid_to: d.valid_to, notification_status: d.notification_status,
  }));
  return NextResponse.json({ ok: true, items });
}
