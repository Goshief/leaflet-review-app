import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";
import { discoverLeafletAssets } from "@/lib/leaflet-monitor/discovery";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

export const runtime = "nodejs";
export const maxDuration = 60;

const USER_AGENT = "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";
const SUPPORTED = new Set<RetailerId>(["lidl", "kaufland", "penny"]);

async function fetchText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/javascript,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
      },
      signal: controller.signal,
    });
    return { response, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function absolute(raw: string, base: string) {
  try {
    const cleaned = raw
      .replace(/&amp;/g, "&")
      .replace(/\\u002F/gi, "/")
      .replace(/\\\//g, "/")
      .trim();
    return new URL(cleaned, base).toString();
  } catch {
    return null;
  }
}

function uniq(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

function extractUrls(text: string, base: string) {
  const raw: string[] = [];
  for (const m of text.matchAll(/https?:\\?\/?\\?\/?[^"'<>\s)]+/gi)) raw.push(m[0]);
  for (const m of text.matchAll(/(?:src|href|url|image|imageUrl|image_url|preview|thumb|thumbnail|contentUrl|downloadUrl|download_url)["']?\s*[:=]\s*["']([^"']+)["']/gi)) raw.push(m[1]);
  for (const m of text.matchAll(/["']([^"']+\.(?:png|jpe?g|webp|json|js)(?:\?[^"']*)?)["']/gi)) raw.push(m[1]);
  return uniq(raw.map((x) => absolute(x, base)));
}

function scorePageImage(url: string) {
  let score = 0;
  const u = decodeURIComponent(url).toLowerCase();
  if (/\.(?:png|jpe?g|webp)(?:$|[?#])/.test(u)) score += 20;
  if (/page[-_/ ]?\d+/.test(u)) score += 30;
  if (/leaflet|publication|flyer|catalog|prospekt/.test(u)) score += 15;
  if (/cover|thumb|thumbnail|logo|icon|favicon|banner/.test(u)) score -= 25;
  return score;
}

async function inspectLidl(viewerUrl: string) {
  const { response, text } = await fetchText(viewerUrl);
  const urls = extractUrls(text, response.url || viewerUrl);
  const candidates = urls
    .filter((u) => /imgproxy\.leaflets\.schwarz|leaflets\/images|page[-_]/i.test(u))
    .map((url) => ({ url, score: scorePageImage(url) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return { final_url: response.url, bytes: Buffer.byteLength(text), candidates: candidates.slice(0, 100) };
}

async function inspectPenny(viewerUrl: string) {
  const { response, text } = await fetchText(viewerUrl);
  const base = response.url || viewerUrl;
  const urls = extractUrls(text, base);
  const follow = uniq([
    ...urls.filter((u) => /files\/publication|build\.js|config|publication.*\.json/i.test(u)),
    absolute("files/html/build.js", base),
  ]).slice(0, 12);

  const expanded: string[] = [...urls];
  for (const url of follow) {
    try {
      const child = await fetchText(url);
      if (child.response.ok) expanded.push(...extractUrls(child.text, child.response.url || url));
    } catch {}
  }

  const candidates = uniq(expanded)
    .map((url) => ({ url, score: scorePageImage(url) }))
    .filter((x) => x.score > 10)
    .sort((a, b) => b.score - a.score);
  return { final_url: response.url, bytes: Buffer.byteLength(text), followed: follow, candidates: candidates.slice(0, 150) };
}

async function inspectKaufland(viewerUrl: string) {
  const { response, text } = await fetchText(viewerUrl);
  const base = response.url || viewerUrl;
  const urls = extractUrls(text, base);
  const scripts = urls.filter((u) => /kaufland\.leaflets\.schwarz\/assets\/.*\.js/i.test(u)).slice(0, 8);
  const expanded: string[] = [...urls];
  for (const url of scripts) {
    try {
      const child = await fetchText(url);
      if (child.response.ok) expanded.push(...extractUrls(child.text, child.response.url || url));
    } catch {}
  }
  const candidates = uniq(expanded)
    .map((url) => ({ url, score: scorePageImage(url) }))
    .filter((x) => x.score > 10)
    .sort((a, b) => b.score - a.score);
  return { final_url: response.url, bytes: Buffer.byteLength(text), followed: scripts, candidates: candidates.slice(0, 150) };
}

export async function GET(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const requestUrl = new URL(req.url);
  const retailerId = requestUrl.searchParams.get("retailer") as RetailerId | null;
  if (!retailerId || !SUPPORTED.has(retailerId)) {
    return NextResponse.json({ ok: false, error: "retailer must be lidl, kaufland or penny" }, { status: 400 });
  }

  try {
    const retailer = getRetailerConfig(retailerId);
    const source = await fetchText(retailer.fetch_url);
    if (!source.response.ok) throw new Error(`source HTTP ${source.response.status}`);
    const asset = discoverLeafletAssets(source.text, source.response.url || retailer.fetch_url, retailerId)[0];
    if (!asset) throw new Error("Nebyl nalezen aktuální viewer asset.");

    let diagnostic;
    if (retailerId === "lidl") diagnostic = await inspectLidl(asset.url);
    else if (retailerId === "penny") diagnostic = await inspectPenny(asset.url);
    else diagnostic = await inspectKaufland(asset.url);

    return NextResponse.json({
      ok: true,
      retailer: retailerId,
      viewer_url: asset.url,
      asset_label: asset.label,
      asset_score: asset.score,
      ...diagnostic,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, retailer: retailerId, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
