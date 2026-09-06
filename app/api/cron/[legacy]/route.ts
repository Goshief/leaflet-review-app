import { NextResponse } from "next/server";
import { isWatchedRetailer } from "@/lib/leaflet-monitor/watcher-config";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  request: Request,
  context: { params: Promise<{ legacy: string }> },
) {
  const { legacy } = await context.params;
  const match = /^fetch-([a-z0-9-]+)-leaflet$/i.exec(legacy);
  const retailer = match?.[1]?.toLowerCase() ?? "";

  if (!retailer || !isWatchedRetailer(retailer)) {
    return NextResponse.json({ ok: false, error: "Neznámá cron route." }, { status: 404 });
  }

  const incoming = new URL(request.url);
  const target = new URL(`/api/cron/fetch-leaflet/${encodeURIComponent(retailer)}`, incoming.origin);
  for (const [key, value] of incoming.searchParams.entries()) target.searchParams.set(key, value);

  const response = await fetch(target, {
    method: "GET",
    cache: "no-store",
    redirect: "follow",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      authorization: request.headers.get("authorization") ?? "",
    },
  });

  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
