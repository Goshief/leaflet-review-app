import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";
import { discoverLeafletAssets } from "@/lib/leaflet-monitor/discovery";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

export const runtime = "nodejs";
export const maxDuration = 60;

const USER_AGENT = "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";
const SUPPORTED = new Set<RetailerId>(["billa", "lidl", "kaufland", "penny"]);
const RESOURCE_HINT = /\.pdf(?:$|[?#])|\.json(?:$|[?#])|\.(?:jpe?g|png|webp|avif)(?:$|[?#])|manifest|download|page|leaflet|flyer/i;

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
}

function inspectResources(html: string, base: string) {
  const out: string[] = [];
  const add = (raw: string) => {
    const decoded = decodeHtml(raw.trim());
    if (!decoded || decoded.startsWith("data:")) return;
    try {
      const url = new URL(decoded, base).toString();
      if (!RESOURCE_HINT.test(url)) return;
      if (!out.includes(url)) out.push(url);
    } catch {}
  };

  for (const match of html.matchAll(/(?:href|src|content|data-src|data-url|downloadUrl|download_url|pdfUrl|pdf_url)["']?\s*[:=]\s*["']([^"']+)["']/gi)) add(match[1] || "");
  for (const match of html.matchAll(/https?:\\?\/?\\?\/?[^"'<>\s)]+/gi)) add(match[0] || "");
  return out.slice(0, 80);
}

async function fetchPage(url: string) {
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
    const bytes = new Uint8Array(await response.arrayBuffer());
    const signature = new TextDecoder().decode(bytes.slice(0, 5));
    const isPdf = Boolean(contentType?.includes("application/pdf") || signature === "%PDF-");
    const html = !isPdf && contentType?.includes("text/html") ? new TextDecoder().decode(bytes) : null;
    return { response, contentType, bytes, isPdf, html };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(url: string, retailer: RetailerId, includeLinks: boolean, deep: boolean) {
  const source = await fetchPage(url);
  const response = source.response;
  const assets = source.html ? discoverLeafletAssets(source.html, response.url || url, retailer) : [];
  const selected = assets[0] ?? null;

  let selectedDetail: unknown = undefined;
  if (deep && selected) {
    try {
      const hit = await fetchPage(selected.url);
      selectedDetail = {
        reachable: hit.response.ok,
        status: hit.response.status,
        final_url: hit.response.url,
        content_type: hit.contentType,
        bytes: hit.bytes.byteLength,
        is_pdf: hit.isPdf,
        resources: hit.html ? inspectResources(hit.html, hit.response.url || selected.url) : [],
      };
    } catch (error) {
      selectedDetail = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    reachable: response.ok,
    status: response.status,
    status_text: response.statusText,
    final_url: response.url,
    content_type: source.contentType,
    selected_asset: selected,
    asset_candidates: includeLinks ? assets.slice(0, 20) : undefined,
    selected_asset_detail: selectedDetail,
  };
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
    const result = await probe(
      retailer.fetch_url,
      retailer.id,
      requestUrl.searchParams.get("inspect") === "1",
      requestUrl.searchParams.get("deep") === "1",
    );
    return NextResponse.json({
      ok: result.reachable && Boolean(result.selected_asset),
      retailer: retailer.id,
      source_url: retailer.source_url,
      fetch_url: retailer.fetch_url,
      ...result,
    }, { status: result.reachable && result.selected_asset ? 200 : 502 });
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
