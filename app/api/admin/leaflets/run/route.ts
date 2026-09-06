import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isWatchedRetailer } from "@/lib/leaflet-monitor/watcher-config";

const SPECIAL: Record<string, string> = {
  billa: "/api/cron/fetch-billa-leaflet",
  lidl: "/api/cron/fetch-lidl-leaflet",
  kaufland: "/api/cron/fetch-kaufland-leaflet",
  penny: "/api/cron/fetch-penny-leaflet",
};

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await createClient();
  const { data } = await auth.auth.getUser();
  if (!data.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const retailer = new URL(request.url).searchParams.get("retailer")?.trim().toLowerCase() ?? "";
  if (!isWatchedRetailer(retailer)) {
    return NextResponse.json({ ok: false, error: "Neznámý retailer." }, { status: 400 });
  }

  const path = SPECIAL[retailer] ?? `/api/cron/fetch-leaflet/${encodeURIComponent(retailer)}`;
  const target = new URL(`${path}?manual=1`, request.url);
  const response = await fetch(target, { method: "GET", cache: "no-store", redirect: "follow" });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    return NextResponse.json({ ok: false, error: String(payload?.error ?? `Crawler HTTP ${response.status}`), crawler: payload }, { status: response.status });
  }
  return NextResponse.json({ ok: true, ...(payload ?? {}) });
}
