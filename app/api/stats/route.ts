import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const requestId = makeRequestId();
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return safeErrorJson({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Datový zdroj není nakonfigurovaný.",
      requestId,
      logContext: { route: "/api/stats", reason: "supabase_missing" },
    });
  }

  try {
    const [imports, raw, quarantine] = await Promise.all([
      supabase.from("imports").select("*", { count: "exact", head: true }),
      supabase.from("offers_raw").select("*", { count: "exact", head: true }),
      supabase.from("offers_quarantine").select("*", { count: "exact", head: true }),
    ]);

    if (imports.error || raw.error || quarantine.error) {
      return safeErrorJson({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Nepodařilo se načíst statistiky.",
        requestId,
        cause: imports.error?.message || raw.error?.message || quarantine.error?.message,
        logContext: { route: "/api/stats", phase: "counts_query" },
      });
    }

    return NextResponse.json({
      ok: true,
      totals: {
        imports: imports.count ?? 0,
        raw_offers: raw.count ?? 0,
        quarantined_offers: quarantine.count ?? 0,
      },
    });
  } catch (e) {
    return safeErrorJson({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Nepodařilo se načíst statistiky.",
      requestId,
      cause: e,
      logContext: { route: "/api/stats", phase: "unexpected_exception" },
    });
  }
}

