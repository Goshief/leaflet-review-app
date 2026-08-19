import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";
import { discoverLeafletAssets } from "@/lib/leaflet-monitor/discovery";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

export const runtime = "nodejs";
export const maxDuration = 60;

const USER_AGENT = "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";
const SUPPORTED = new Set<RetailerId>(["lidl", "kaufland", "penny"]);

async function fetchText(url: string, accept = "text/html,application/json;q=0.9,*/*;q=0.8") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5" },
      signal: controller.signal,
    });
    return { response, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function collectImageUrls(value: unknown, out = new Set<string>()) {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && /(?:imgproxy\.leaflets\.schwarz|\.(?:png|jpe?g|webp)(?:$|[?#]))/i.test(value)) out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageUrls(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectImageUrls(item, out);
  }
  return out;
}

function collectPdfUrls(value: unknown, out = new Set<string>()) {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && /\.pdf(?:$|[?#])/i.test(value)) out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPdfUrls(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectPdfUrls(item, out);
  }
  return out;
}

function findPages(value: unknown): unknown[] | null {
  if (Array.isArray(value) && value.length > 0 && value.every((x) => x && typeof x === "object")) {
    const sample = value.slice(0, 3) as Record<string, unknown>[];
    if (sample.some((x) => "number" in x || "pageNumber" in x || "links" in x || "keyWords" in x || "image" in x || "imageUrl" in x)) return value;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/pages/i.test(key) && Array.isArray(child) && child.length) return child;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      const found = findPages(child);
      if (found) return found;
    }
  }
  return null;
}

function summarizePage(page: unknown) {
  if (!page || typeof page !== "object") return page;
  const p = page as Record<string, unknown>;
  const pick: Record<string, unknown> = {};
  for (const key of ["id", "number", "pageNumber", "name", "keyWords", "keywords", "altText", "image", "imageUrl", "url", "thumbnailUrl", "links"]) {
    if (p[key] !== undefined) pick[key] = p[key];
  }
  return pick;
}

function schwarzIdentifier(retailer: RetailerId, viewerUrl: string) {
  const url = new URL(viewerUrl);
  if (retailer === "kaufland") {
    const match = url.pathname.match(/\/([^/]+)\/ar\/([^/]+)/i);
    return { identifier: match?.[1] ?? null, region: match?.[2] ?? null };
  }
  const match = url.pathname.match(/\/letak\/([^/]+)\/view\/flyer/i);
  return { identifier: match?.[1] ?? null, region: null };
}

async function inspectSchwarz(retailer: RetailerId, viewerUrl: string) {
  const ids = schwarzIdentifier(retailer, viewerUrl);
  if (!ids.identifier) throw new Error("Z viewer URL se nepodařilo určit flyer_identifier.");

  const attempts = [
    new URL(`/v4/flyer?flyer_identifier=${encodeURIComponent(ids.identifier)}`, "https://endpoints.leaflets.schwarz").toString(),
  ];
  if (ids.region) {
    attempts.unshift(new URL(`/v4/flyer?flyer_identifier=${encodeURIComponent(ids.identifier)}&region_id=${encodeURIComponent(ids.region)}&region_code=${encodeURIComponent(ids.region)}`, "https://endpoints.leaflets.schwarz").toString());
  }

  const results: Array<Record<string, unknown>> = [];
  for (const apiUrl of attempts) {
    try {
      const { response, text } = await fetchText(apiUrl, "application/json,text/plain,*/*");
      let json: unknown = null;
      try { json = JSON.parse(text); } catch {}
      const pages = json ? findPages(json) : null;
      const images = json ? [...collectImageUrls(json)] : [];
      const pdfs = json ? [...collectPdfUrls(json)] : [];
      results.push({
        api_url: apiUrl,
        status: response.status,
        content_type: response.headers.get("content-type"),
        json: Boolean(json),
        top_keys: json && typeof json === "object" && !Array.isArray(json) ? Object.keys(json as Record<string, unknown>) : [],
        page_count: pages?.length ?? 0,
        first_page: pages?.length ? summarizePage(pages[0]) : null,
        middle_page: pages?.length ? summarizePage(pages[Math.floor(pages.length / 2)]) : null,
        last_page: pages?.length ? summarizePage(pages[pages.length - 1]) : null,
        image_count: images.length,
        first_images: images.slice(0, 5),
        pdf_count: pdfs.length,
        pdfs: pdfs.slice(0, 5),
        body_preview: json ? undefined : text.slice(0, 500),
      });
      if (response.ok && json && ((pages?.length ?? 0) > 0 || images.length > 0 || pdfs.length > 0)) break;
    } catch (error) {
      results.push({ api_url: apiUrl, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { identifier: ids.identifier, region: ids.region, attempts: results };
}

async function inspectPenny(viewerUrl: string) {
  const rootResponse = await fetchText(viewerUrl);
  if (!rootResponse.response.ok) throw new Error(`Penny viewer HTTP ${rootResponse.response.status}`);
  const root = (rootResponse.response.url || viewerUrl).replace(/\/?$/, "/");
  const pageNumbers = [...rootResponse.text.matchAll(/href=["'](?:\.\/)?(\d+)\/?["']/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 500);
  const pageCount = pageNumbers.length ? Math.max(...pageNumbers) : 1;
  const sampleNumbers = [...new Set([1, Math.ceil(pageCount / 2), pageCount])];
  const samples = [];
  for (const page of sampleNumbers) {
    const url = page === 1 ? root : new URL(`${page}/`, root).toString();
    const fetched = await fetchText(url);
    const clean = fetched.response.ok ? stripHtml(fetched.text) : "";
    samples.push({ page, url: fetched.response.url || url, status: fetched.response.status, text_length: clean.length, text_preview: clean.slice(0, 800) });
  }
  return { page_count: pageCount, sample_pages: samples };
}

export async function GET(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const retailerId = new URL(req.url).searchParams.get("retailer") as RetailerId | null;
  if (!retailerId || !SUPPORTED.has(retailerId)) {
    return NextResponse.json({ ok: false, error: "retailer must be lidl, kaufland or penny" }, { status: 400 });
  }

  try {
    const retailer = getRetailerConfig(retailerId);
    const source = await fetchText(retailer.fetch_url);
    if (!source.response.ok) throw new Error(`source HTTP ${source.response.status}`);
    const asset = discoverLeafletAssets(source.text, source.response.url || retailer.fetch_url, retailerId)[0];
    if (!asset) throw new Error("Nebyl nalezen aktuální viewer asset.");

    const diagnostic = retailerId === "penny"
      ? await inspectPenny(asset.url)
      : await inspectSchwarz(retailerId, asset.url);

    return NextResponse.json({ ok: true, retailer: retailerId, viewer_url: asset.url, asset_label: asset.label, asset_score: asset.score, ...diagnostic });
  } catch (error) {
    return NextResponse.json({ ok: false, retailer: retailerId, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
