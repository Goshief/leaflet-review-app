import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: true, configured: false, retailers: [], total: 0 });
  const url = new URL(request.url);
  const includePending = url.searchParams.get("includePending") === "1";

  try {
    let query = supabase
      .from("catalog_sources")
      .select("retailer_id,display_name,base_url,enabled,collector_status,capabilities,last_success_at,last_discovered_count")
      .order("display_name");
    if (!includePending) query = query.eq("collector_status", "verified").eq("enabled", true);
    const { data, error } = await query;
    if (error) throw error;
    const retailers = data ?? [];
    return NextResponse.json({ ok: true, configured: true, retailers, total: retailers.length });
  } catch (error) {
    console.error("[setrik-retailers]", error);
    return NextResponse.json({ ok: false, error: "Seznam obchodů není momentálně dostupný." }, { status: 503 });
  }
}
