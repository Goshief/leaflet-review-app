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
      redirect: "follow", cache: "no-store",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/javascript,application/json;q=0.9,*/*;q=0.8", "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5" },
      signal: controller.signal,
    });
    return { response, text: await response.text() };
  } finally { clearTimeout(timer); }
}

async function probeUrl(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { redirect: "follow", cache: "no-store", headers: { "User-Agent": USER_AGENT, Range: "bytes=0-31" }, signal: controller.signal });
    const type = response.headers.get("content-type") || "";
    const length = response.headers.get("content-length");
    try { await response.body?.cancel(); } catch {}
    return { url, ok: response.ok, status: response.status, content_type: type, content_length: length, final_url: response.url };
  } catch (error) {
    return { url, ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timer); }
}

function absolute(raw: string, base: string) {
  try { return new URL(raw.replace(/&amp;/g, "&").replace(/\\u002F/gi, "/").replace(/\\\//g, "/").trim(), base).toString(); } catch { return null; }
}
function uniq(values: Array<string | null | undefined>) { return [...new Set(values.filter((v): v is string => Boolean(v)))]; }
function extractUrls(text: string, base: string) {
  const raw: string[] = [];
  for (const m of text.matchAll(/https?:\\?\/?\\?\/?[^"'<>\s)]+/gi)) raw.push(m[0]);
  for (const m of text.matchAll(/(?:src|href|url|image|imageUrl|image_url|preview|thumb|thumbnail|contentUrl|downloadUrl|download_url|content)["']?\s*[:=]\s*["']([^"']+)["']/gi)) raw.push(m[1]);
  for (const m of text.matchAll(/["']([^"']+\.(?:png|jpe?g|webp|json|js)(?:\?[^"']*)?)["']/gi)) raw.push(m[1]);
  return uniq(raw.map((x) => absolute(x, base)));
}
function interestingSnippets(text: string) {
  const needles = ["getImageFileName", "getPageFileName", "page-html5-substrates", "endpoints.leaflets.schwarz", "cms.leaflets.schwarz", "/api/", "publication", "pageImage", "imageUrl", "pages/", "DYNAMIC_FOLDER", "PAGE_COUNT", "PAGES"];
  const out: string[] = []; const lower = text.toLowerCase();
  for (const needle of needles) { let from = 0; while (out.length < 50) { const at = lower.indexOf(needle.toLowerCase(), from); if (at < 0) break; out.push(text.slice(Math.max(0, at - 260), Math.min(text.length, at + 620)).replace(/\s+/g, " ")); from = at + needle.length; } }
  return uniq(out).slice(0, 50);
}
function extractFbInit(text: string) {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/FBInit\.([A-Z0-9_]+)\s*=\s*([^;]+);/g)) out[m[1]] = (m[2] || "").trim().slice(0, 3000);
  return out;
}

async function inspectLidl(viewerUrl: string) {
  const { response, text } = await fetchText(viewerUrl); const base = response.url || viewerUrl; const urls = extractUrls(text, base);
  const scripts = urls.filter((u) => /leaflets\.schwarz\/.*\.js/i.test(u)).slice(0, 8); const expanded: string[] = [...urls]; const snippets: string[] = [];
  for (const url of scripts) { try { const child = await fetchText(url); if (child.response.ok) { expanded.push(...extractUrls(child.text, child.response.url || url)); snippets.push(...interestingSnippets(child.text)); } } catch {} }
  return { final_url: response.url, bytes: Buffer.byteLength(text), followed: scripts, viewer_snippets: interestingSnippets(text), urls: uniq(expanded).slice(0, 120), snippets: uniq(snippets).slice(0, 40) };
}

async function inspectPenny(viewerUrl: string) {
  const { response, text } = await fetchText(viewerUrl); const base = response.url || viewerUrl; const root = base.endsWith("/") ? base : `${base}/`; const urls = extractUrls(text, base); const fbInit = extractFbInit(text);
  const buildUrl = absolute("files/html/build.js", base)!; let buildText = ""; try { const build = await fetchText(buildUrl); if (build.response.ok) buildText = build.text; } catch {}
  let seo2Text = ""; let seo2Url = new URL("2/", root).toString(); try { const seo2 = await fetchText(seo2Url); seo2Url = seo2.response.url || seo2Url; if (seo2.response.ok) seo2Text = seo2.text; } catch {}
  const seo2Urls = extractUrls(seo2Text, seo2Url);
  const imageLikeSeo = seo2Urls.filter((u) => /\.(?:png|jpe?g|webp)(?:$|[?#])/i.test(u));
  const probes = await Promise.all(uniq([new URL("files/assets/cover300.jpg", root).toString(), ...imageLikeSeo.slice(0, 12)]).map(probeUrl));
  const numericPages = [...text.matchAll(/(?:href|content)=["'](?:\.\/)?(\d+)\/?["']/gi)].map((m) => Number(m[1])).filter((n) => Number.isInteger(n) && n > 0 && n < 500);
  return { final_url: response.url, bytes: Buffer.byteLength(text), page_count_hint: numericPages.length ? Math.max(...numericPages) : null, fb_init: fbInit, viewer_snippets: interestingSnippets(text), build_url: buildUrl, build_bytes: Buffer.byteLength(buildText), build_snippets: interestingSnippets(buildText), seo_page_2_url: seo2Url, seo_page_2_bytes: Buffer.byteLength(seo2Text), seo_page_2_images: imageLikeSeo, seo_page_2_snippets: interestingSnippets(seo2Text), probes, urls: uniq([...urls, ...extractUrls(buildText, buildUrl), ...seo2Urls]).slice(0, 220) };
}

async function inspectKaufland(viewerUrl: string) {
  const { response, text } = await fetchText(viewerUrl); const base = response.url || viewerUrl; const urls = extractUrls(text, base);
  const scripts = urls.filter((u) => /kaufland\.leaflets\.schwarz\/assets\/.*\.js/i.test(u)).slice(0, 8); const expanded: string[] = [...urls]; const snippets: string[] = [];
  for (const url of scripts) { try { const child = await fetchText(url); if (child.response.ok) { expanded.push(...extractUrls(child.text, child.response.url || url)); snippets.push(...interestingSnippets(child.text)); } } catch {} }
  return { final_url: response.url, bytes: Buffer.byteLength(text), followed: scripts, viewer_snippets: interestingSnippets(text), urls: uniq(expanded).slice(0, 180), snippets: uniq(snippets).slice(0, 40) };
}

export async function GET(req: Request) {
  const gate = await requireOperatorApi(); if (!gate.ok) return gate.response;
  const retailerId = new URL(req.url).searchParams.get("retailer") as RetailerId | null;
  if (!retailerId || !SUPPORTED.has(retailerId)) return NextResponse.json({ ok: false, error: "retailer must be lidl, kaufland or penny" }, { status: 400 });
  try {
    const retailer = getRetailerConfig(retailerId); const source = await fetchText(retailer.fetch_url); if (!source.response.ok) throw new Error(`source HTTP ${source.response.status}`);
    const asset = discoverLeafletAssets(source.text, source.response.url || retailer.fetch_url, retailerId)[0]; if (!asset) throw new Error("Nebyl nalezen aktuální viewer asset.");
    const diagnostic = retailerId === "lidl" ? await inspectLidl(asset.url) : retailerId === "penny" ? await inspectPenny(asset.url) : await inspectKaufland(asset.url);
    return NextResponse.json({ ok: true, retailer: retailerId, viewer_url: asset.url, asset_label: asset.label, asset_score: asset.score, ...diagnostic });
  } catch (error) { return NextResponse.json({ ok: false, retailer: retailerId, error: error instanceof Error ? error.message : String(error) }, { status: 502 }); }
}
