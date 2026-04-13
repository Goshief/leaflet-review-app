import { NextResponse } from "next/server";
import { getDbUrl, withPgClient } from "@/lib/db/pg";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, status: "error", supabase: "missing_admin_env" }, { status: 500 });
  }

  try {
    const supabaseProbe = await supabase.from("carts").select("id").limit(1);
    if (supabaseProbe.error) {
      return NextResponse.json(
        { ok: false, status: "error", supabase: "unreachable", error: supabaseProbe.error.message },
        { status: 500 }
      );
    }

    const hasDbUrl = Boolean(getDbUrl());
    if (!hasDbUrl) {
      return NextResponse.json({ ok: true, status: "ok", supabase: "reachable", db: "missing_url" }, { status: 200 });
    }

    await withPgClient((c) => c.query("select 1"));
    return NextResponse.json({ ok: true, status: "ok", supabase: "reachable", db: "reachable" }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        status: "error",
        supabase: "reachable",
        db: "unreachable",
        error: e instanceof Error ? e.message : "unknown",
      },
      { status: 500 }
    );
  }
}
