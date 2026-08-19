import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

export const runtime = "nodejs";
export const maxDuration = 60;

const USER_AGENT = "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";
const SUPPORTED = new Set<RetailerId>(["billa", "lidl", "kaufland", "penny"]);
const RELEVANT = /leták|letak|leaflet|brožur|brozur|katalog|catalog|prohlédnout|prohlednout|prolistovat|akční|akcni|pdf/i;

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function inspectLinks(html: string, base: string) {
  const rows: Array<{ label: string; url: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = decodeHtml(match[1] || "");
    const label = decodeHtml((match[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    let url: string;
    try { url = new URL(raw, base).toString(); } catch { continue; }
    if (!RELEVANT.test(`${label} ${url}`)) continue;
    rows.push({ label: label.slice(0, 180), url });
  }
  return rows.filter((row, index, all) => all.findIndex((x) => x.url === row.url && x.label === row.label) === index).slice(0, 40);
}

async function probe(url: string, includeLinks: boolean) {
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
    const contentType = response.headers.get("content-type");
    const html = includeLinks && response.ok && contentType?.includes("text/html") ? await response.text() : null;
    return {
      reachable: response.ok,
      status: response.status,
      status_text: response.statusText,
      final_url: response.url,
      content_type: contentType,
      relevant_links: html ? inspectLinks(html, response.url || url) : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const requestUrl = new URL(req.url);
  const raw = requestUrl.searchParams.get("retailer") as RetailerId | null;
  if (!raw || !SUPPORTED.has(raw)) {
    return NextResponse.json({ ok: false, error: "retailer must be one of billa, lidl, kaufland, penny" }, { status: 400 });
  }

  const retailer = getRetailerConfig(raw);
  try {
    const result = await probe(retailer.fetch_url, requestUrl.searchParams.get("inspect") === "1");
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
