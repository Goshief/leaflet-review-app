import { NextResponse } from "next/server";
import { runDmCatalogCollector } from "@/lib/catalog-collector/dm-runner";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

function requestedLimit(req: Request) {
  const raw = new URL(req.url).searchParams.get("limit");
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(120, Math.floor(value)));
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET není nakonfigurovaný; dm collector se nespustil." },
      { status: 503 }
    );
  }
  if ((req.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase admin klient není nakonfigurovaný." }, { status: 503 });
  }

  try {
    const stats = await runDmCatalogCollector(supabase, { limit: requestedLimit(req) });
    return NextResponse.json({ ok: true, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[catalog-collector:dm]", { error: message });
    return NextResponse.json({ ok: false, retailer: "dm", error: message }, { status: 500 });
  }
}
