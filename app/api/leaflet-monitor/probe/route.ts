import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

export const runtime = "nodejs";
export const maxDuration = 60;

const USER_AGENT = "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";
const SUPPORTED = new Set<RetailerId>(["billa", "lidl", "kaufland", "penny"]);

async function probe(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/pdf;q=0.9,*/*;q=0.8",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
      },
      signal: controller.signal,
    });
    return {
      reachable: response.ok,
      status: response.status,
      status_text: response.statusText,
      final_url: response.url,
      content_type: response.headers.get("content-type"),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const raw = new URL(req.url).searchParams.get("retailer") as RetailerId | null;
  if (!raw || !SUPPORTED.has(raw)) {
    return NextResponse.json({ ok: false, error: "retailer must be one of billa, lidl, kaufland, penny" }, { status: 400 });
  }

  const retailer = getRetailerConfig(raw);
  try {
    const result = await probe(retailer.fetch_url);
    return NextResponse.json({
      ok: result.reachable,
      retailer: retailer.id,
      source_url: retailer.source_url,
      fetch_url: retailer.fetch_url,
      ...result,
    }, { status: result.reachable ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      retailer: retailer.id,
      source_url: retailer.source_url,
      fetch_url: retailer.fetch_url,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
