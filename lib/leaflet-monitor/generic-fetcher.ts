import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  recordObservation,
  shouldVisitRetailer,
  type RetailerId,
  type RetailerLearningState,
} from "@/lib/leaflet-monitor/learning";

const BUCKET = "leaflet-intake";
const USER_AGENT = "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";

type Config = {
  retailer: RetailerId;
  sourcePage: string;
  cronSchedule: string;
  preferredLabels: RegExp[];
};

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
}
function absoluteUrl(raw: string, baseUrl: string): string | null { try { return new URL(decodeHtml(raw.trim()).replace(/\\u0026/gi, "&"), baseUrl).toString(); } catch { return null; } }
function extractPdfUrls(html: string, baseUrl: string): string[] {
  const found = new Set<string>(); const add = (raw: string) => { const value = absoluteUrl(raw, baseUrl); if (value && /\.pdf(?:$|[?#])/i.test(value)) found.add(value); };
  for (const m of html.matchAll(/https?:\\?\/?\\?\/?[^"'<>\s]+?\.pdf(?:\?[^"'<>\s]*)?/gi)) add(m[0] ?? "");
  for (const m of html.matchAll(/(?:href|src|downloadUrl|download_url|pdfUrl|pdf_url|contentUrl)["']?\s*[:=]\s*["']([^"']+)["']/gi)) add(m[1] ?? "");
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) { const label = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); if (/pdf|download|stáhnout|stahnout/i.test(label)) add(m[1] ?? ""); }
  return [...found];
}
function extractViewerCandidates(html: string, baseUrl: string, preferredLabels: RegExp[]): string[] {
  const ranked: Array<{ url: string; score: number }> = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absoluteUrl(m[1] ?? "", baseUrl); if (!url) continue;
    const text = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); const haystack = `${text} ${url}`; let score = 0;
    if (/leták|letak|leaflet|brochure|katalog|catalog|prohlédnout|prolistovat/i.test(haystack)) score += 4;
    if (/aktuální|aktualni|týden|tyden|akční|akcni|supermarket|hypermarket/i.test(haystack)) score += 2;
    preferredLabels.forEach((rx, i) => { if (rx.test(haystack)) score += 20 - i; }); if (score > 0) ranked.push({ url, score });
  }
  return ranked.sort((a, b) => b.score - a.score).map((x) => x.url).filter((url, i, arr) => arr.indexOf(url) === i).slice(0, 16);
}
async function fetchWithTimeout(url: string, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { redirect: "follow", cache: "no-store", headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/pdf;q=0.9,*/*;q=0.8", "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5" }, signal: controller.signal }); } finally { clearTimeout(timer); }
}
async function asPdf(response: Response): Promise<{ url: string; bytes: Uint8Array } | null> { if (!response.ok) return null; const bytes = new Uint8Array(await response.arrayBuffer()); const type = response.headers.get("content-type") ?? ""; const sig = new TextDecoder().decode(bytes.slice(0, 5)); return type.includes("application/pdf") || sig === "%PDF-" ? { url: response.url, bytes } : null; }
async function resolvePdf(sourceHtml: string, sourceUrl: string, preferredLabels: RegExp[]) {
  for (const url of extractPdfUrls(sourceHtml, sourceUrl).slice(0, 12)) { try { const hit = await asPdf(await fetchWithTimeout(url)); if (hit) return { ...hit, viewer_url: sourceUrl }; } catch {} }
  for (const viewerUrl of extractViewerCandidates(sourceHtml, sourceUrl, preferredLabels)) {
    try {
      const viewer = await fetchWithTimeout(viewerUrl); if (!viewer.ok) continue; const bytes = new Uint8Array(await viewer.arrayBuffer()); const type = viewer.headers.get("content-type") ?? ""; const sig = new TextDecoder().decode(bytes.slice(0, 5));
      if (type.includes("application/pdf") || sig === "%PDF-") return { url: viewer.url || viewerUrl, bytes, viewer_url: viewerUrl };
      const html = new TextDecoder().decode(bytes); for (const pdfUrl of extractPdfUrls(html, viewer.url || viewerUrl).slice(0, 12)) { try { const hit = await asPdf(await fetchWithTimeout(pdfUrl)); if (hit) return { ...hit, viewer_url: viewerUrl }; } catch {} }
    } catch {}
  }
  throw new Error("Na webu obchodu se nepodařilo najít PDF aktuálního letáku.");
}
async function readLearning(supabase: any, retailer: RetailerId): Promise<RetailerLearningState | null> { const { data, error } = await supabase.storage.from(BUCKET).download(`_learning/${retailer}.json`); if (error || !data) return null; try { return JSON.parse(await data.text()) as RetailerLearningState; } catch { return null; } }
async function writeLearning(supabase: any, state: RetailerLearningState) { await supabase.storage.from(BUCKET).upload(`_learning/${state.retailer}.json`, new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), { contentType: "application/json", upsert: true }); }
function todayPrague(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export async function runGenericLeafletConnector(req: Request, config: Config) {
  const url = new URL(req.url); const manual = url.searchParams.get("manual") === "1";
  const secret = process.env.CRON_SECRET?.trim(); const auth = req.headers.get("authorization") ?? ""; const schedule = req.headers.get("x-vercel-cron-schedule") ?? "";
  if (!manual) {
    if (secret) { if (auth !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }); }
    else if (schedule !== config.cronSchedule) return NextResponse.json({ ok: false, error: "Cron only" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin(); if (!supabase) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });
  const learning = await readLearning(supabase, config.retailer);
  if (!manual) {
    const decision = shouldVisitRetailer(learning);
    if (!decision.due) return NextResponse.json({ ok: true, status: "adaptive_skip", retailer: config.retailer, reason: decision.reason, checks_this_week: decision.checks_this_week, next_check_at: learning?.next_check_at ?? null });
  }

  const checkedAt = new Date().toISOString(); const marker = `_checks/${config.retailer}-${todayPrague()}.json`;
  if (!manual) {
    const { data: existingMarker } = await supabase.storage.from(BUCKET).list("_checks", { search: `${config.retailer}-${todayPrague()}.json`, limit: 1 });
    if ((existingMarker ?? []).some((x: any) => x.name === `${config.retailer}-${todayPrague()}.json`)) return NextResponse.json({ ok: true, status: "already_checked_today", retailer: config.retailer });
  }

  try {
    const source = await fetchWithTimeout(config.sourcePage); if (!source.ok) throw new Error(`${config.retailer} source HTTP ${source.status}`);
    const sourceHtml = await source.text(); const pdf = await resolvePdf(sourceHtml, source.url || config.sourcePage, config.preferredLabels); const sha256 = createHash("sha256").update(pdf.bytes).digest("hex"); const shortSha = sha256.slice(0, 16);
    const { data: existing } = await supabase.storage.from(BUCKET).list(config.retailer, { search: shortSha, limit: 20 }); const alreadyStored = (existing ?? []).some((x: any) => x.name?.includes(shortSha));
    if (alreadyStored) {
      const payload = { checked_at: checkedAt, visited_url: config.sourcePage, retailer: config.retailer, status: "unchanged", manual, viewer_url: pdf.viewer_url, pdf_url: pdf.url, sha256 };
      await supabase.storage.from(BUCKET).upload(marker, new Blob([JSON.stringify(payload)], { type: "application/json" }), { contentType: "application/json", upsert: true }); const next = recordObservation(learning, config.retailer, "unchanged", checkedAt, config.sourcePage); await writeLearning(supabase, next); return NextResponse.json({ ok: true, ...payload, learning: next });
    }
    const filename = `${config.retailer}-${todayPrague()}__${shortSha}.pdf`; const storagePath = `${config.retailer}/${filename}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, pdf.bytes, { contentType: "application/pdf", upsert: false, cacheControl: "3600" }); if (uploadError) throw new Error(`Storage upload: ${uploadError.message}`);
    const payload = { checked_at: checkedAt, visited_url: config.sourcePage, retailer: config.retailer, status: "downloaded", manual, viewer_url: pdf.viewer_url, pdf_url: pdf.url, sha256, bytes: pdf.bytes.byteLength, storage_path: storagePath };
    await supabase.storage.from(BUCKET).upload(marker, new Blob([JSON.stringify(payload)], { type: "application/json" }), { contentType: "application/json", upsert: true }); const next = recordObservation(learning, config.retailer, "downloaded", checkedAt, config.sourcePage); await writeLearning(supabase, next); return NextResponse.json({ ok: true, ...payload, learning: next });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error); const payload = { checked_at: checkedAt, visited_url: config.sourcePage, retailer: config.retailer, status: "error", manual, error: message };
    await supabase.storage.from(BUCKET).upload(marker, new Blob([JSON.stringify(payload)], { type: "application/json" }), { contentType: "application/json", upsert: true }); const next = recordObservation(learning, config.retailer, "error", checkedAt, config.sourcePage); await writeLearning(supabase, next); console.error(`[${config.retailer}-leaflet-cron]`, message); return NextResponse.json({ ok: false, ...payload, learning: next }, { status: 502 });
  }
}
