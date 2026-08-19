import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { processLeafletPdf } from "@/lib/leaflet-review/processor";
import { discoverLeafletAssets, type LeafletAsset } from "@/lib/leaflet-monitor/discovery";
import { recordObservation, shouldVisitRetailer, type RetailerId, type RetailerLearningState } from "@/lib/leaflet-monitor/learning";

const BUCKET = "leaflet-intake";
const USER_AGENT = "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";
type Config = { retailer: RetailerId; sourcePage: string; cronSchedule: string; preferredLabels: RegExp[]; autoProcess?: boolean };
type PdfHit = { url: string; bytes: Uint8Array; viewer_url: string; asset: LeafletAsset };

function decodeHtml(v: string) {
  return v.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
}
function absoluteUrl(raw: string, base: string) {
  try { return new URL(decodeHtml(raw.trim()).replace(/\\u0026/gi, "&"), base).toString(); } catch { return null; }
}
function extractPdfUrls(html: string, base: string) {
  const found = new Set<string>();
  const add = (raw: string) => {
    const value = absoluteUrl(raw, base);
    if (value && /\.pdf(?:$|[?#])/i.test(value) && !/udržitelnost|udrzitelnost|výroční|vyrocni|privacy|compliance/i.test(decodeURIComponent(value))) found.add(value);
  };
  for (const match of html.matchAll(/https?:\\?\/?\\?\/?[^"'<>\s]+?\.pdf(?:\?[^"'<>\s]*)?/gi)) add(match[0] || "");
  for (const match of html.matchAll(/(?:href|src|downloadUrl|download_url|pdfUrl|pdf_url|contentUrl)["']?\s*[:=]\s*["']([^"']+)["']/gi)) add(match[1] || "");
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = (match[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    if (/pdf|download|stáhnout|stahnout/i.test(label)) add(match[1] || "");
  }
  return [...found];
}

function canonicalAssetUrl(retailer: RetailerId, rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    if (retailer === "lidl") {
      url.pathname = url.pathname.replace(/\/view\/flyer\/page\/\d+\/?$/i, "/view/flyer");
      url.search = "";
    } else if (retailer === "kaufland" || retailer === "penny") {
      url.search = "";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return rawUrl;
  }
}

function viewerFingerprint(retailer: RetailerId, assetUrl: string) {
  const canonical = canonicalAssetUrl(retailer, assetUrl);
  return `viewer:${createHash("sha256").update(`${retailer}|${canonical}`).digest("hex")}`;
}

function rememberAsset(state: RetailerLearningState, fingerprint: string, assetUrl: string, storagePath?: string | null): RetailerLearningState {
  return {
    ...state,
    last_asset_fingerprint: fingerprint,
    last_asset_url: assetUrl,
    last_storage_path: storagePath ?? state.last_storage_path ?? null,
  };
}

function assetMarkerPath(retailer: RetailerId, fingerprint: string) {
  const digest = createHash("sha256").update(fingerprint).digest("hex");
  return `_assets/${retailer}/${digest}.json`;
}

async function claimAssetMarker(s: any, retailer: RetailerId, fingerprint: string, assetUrl: string, checkedAt: string) {
  const path = assetMarkerPath(retailer, fingerprint);
  const payload = JSON.stringify({ retailer, fingerprint, asset_url: assetUrl, first_seen_at: checkedAt });
  const { error } = await s.storage.from(BUCKET).upload(path, new Blob([payload], { type: "application/json" }), {
    contentType: "application/json",
    upsert: false,
    cacheControl: "31536000",
  });
  if (!error) return { isNew: true, path };
  if (/already exists|duplicate|resource exists/i.test(error.message || "")) return { isNew: false, path };
  throw new Error(`Asset registry: ${error.message}`);
}

async function fetchWithTimeout(url: string, timeoutMs = 30000) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      if ((response.status < 500 && response.status !== 429) || attempt === 2) return response;
      try { await response.body?.cancel(); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Retailer fetch failed");
}

async function asPdf(response: Response) {
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const type = response.headers.get("content-type") || "";
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  return type.includes("application/pdf") || signature === "%PDF-" ? { url: response.url, bytes } : null;
}

async function resolveSelectedAsset(sourceHtml: string, sourceUrl: string, retailer: RetailerId): Promise<{ asset: LeafletAsset; pdf: PdfHit | null }> {
  const asset = discoverLeafletAssets(sourceHtml, sourceUrl, retailer)[0];
  if (!asset) throw new Error("Na webu obchodu nebyl nalezen žádný důvěryhodný aktuální letákový asset.");

  if (asset.kind === "pdf") {
    const direct = await asPdf(await fetchWithTimeout(asset.url));
    if (!direct) throw new Error("Vybraný letákový PDF odkaz nevrátil platný PDF soubor.");
    return { asset, pdf: { ...direct, viewer_url: asset.url, asset } };
  }

  const viewer = await fetchWithTimeout(asset.url);
  if (!viewer.ok) throw new Error(`Vybraný letákový viewer HTTP ${viewer.status}`);
  const bytes = new Uint8Array(await viewer.arrayBuffer());
  const type = viewer.headers.get("content-type") || "";
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (type.includes("application/pdf") || signature === "%PDF-") {
    return { asset, pdf: { url: viewer.url || asset.url, bytes, viewer_url: asset.url, asset } };
  }

  const html = new TextDecoder().decode(bytes);
  for (const pdfUrl of extractPdfUrls(html, viewer.url || asset.url).slice(0, 16)) {
    try {
      const hit = await asPdf(await fetchWithTimeout(pdfUrl));
      if (hit) return { asset, pdf: { ...hit, viewer_url: asset.url, asset } };
    } catch {}
  }
  return { asset, pdf: null };
}

async function readLearning(s: any, retailer: RetailerId): Promise<RetailerLearningState | null> {
  const { data, error } = await s.storage.from(BUCKET).download(`_learning/${retailer}.json`);
  if (error || !data) return null;
  try { return JSON.parse(await data.text()); } catch { return null; }
}
async function writeLearning(s: any, state: RetailerLearningState) {
  await s.storage.from(BUCKET).upload(`_learning/${state.retailer}.json`, new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), { contentType: "application/json", upsert: true });
}
function todayPrague() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
async function processIfNeeded(s: any, config: Config, path: string, bytes: Uint8Array, sourceUrl: string, force = false) {
  if (config.autoProcess === false || String(config.retailer) === "albert") return null;
  const { data: old } = await s.from("leaflet_documents").select("id,processing_status,processed_pages,page_count").eq("storage_bucket", BUCKET).eq("storage_path", path).maybeSingle();
  if (!force && (old?.processing_status === "completed" || old?.processing_status === "ready_for_review" || old?.processing_status === "partially_reviewed")) return old;
  return processLeafletPdf({ supabase: s, bucket: BUCKET, path, retailer: String(config.retailer), sourceUrl, bytes, force });
}

export async function runGenericLeafletConnector(req: Request, config: Config) {
  const url = new URL(req.url);
  const manual = url.searchParams.get("manual") === "1";
  const reprocess = manual && url.searchParams.get("reprocess") === "1";
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization") || "";
  const schedule = req.headers.get("x-vercel-cron-schedule") || "";
  if (!manual) {
    if (secret) { if (auth !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }); }
    else if (schedule !== config.cronSchedule) return NextResponse.json({ ok: false, error: "Cron only" }, { status: 401 });
  }

  const s = getSupabaseAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });
  const learning = await readLearning(s, config.retailer);
  if (!manual) {
    const decision = shouldVisitRetailer(learning);
    if (!decision.due) return NextResponse.json({ ok: true, status: "adaptive_skip", retailer: config.retailer, reason: decision.reason, checks_this_week: decision.checks_this_week, next_check_at: learning?.next_check_at ?? null });
  }

  const checkedAt = new Date().toISOString();
  const marker = `_checks/${config.retailer}-${todayPrague()}.json`;
  let claimedMarkerPath: string | null = null;
  let claimedMarkerIsNew = false;
  if (!manual) {
    const { data: existingMarker } = await s.storage.from(BUCKET).list("_checks", { search: `${config.retailer}-${todayPrague()}.json`, limit: 1 });
    if ((existingMarker || []).some((x: any) => x.name === `${config.retailer}-${todayPrague()}.json`)) return NextResponse.json({ ok: true, status: "already_checked_today", retailer: config.retailer });
  }

  try {
    const source = await fetchWithTimeout(config.sourcePage);
    if (!source.ok) throw new Error(`${config.retailer} source HTTP ${source.status}`);
    const sourceHtml = await source.text();
    const resolved = await resolveSelectedAsset(sourceHtml, source.url || config.sourcePage, config.retailer);

    if (!resolved.pdf) {
      const fingerprint = viewerFingerprint(config.retailer, resolved.asset.url);
      const claim = await claimAssetMarker(s, config.retailer, fingerprint, resolved.asset.url, checkedAt);
      claimedMarkerPath = claim.path;
      claimedMarkerIsNew = claim.isNew;
      const status = !reprocess && !claim.isNew ? "unchanged" as const : "asset_found" as const;
      const payload = {
        checked_at: checkedAt,
        visited_url: config.sourcePage,
        retailer: config.retailer,
        status,
        manual,
        asset_url: resolved.asset.url,
        asset_fingerprint: fingerprint,
        asset_label: resolved.asset.label,
        asset_kind: resolved.asset.kind,
        asset_score: resolved.asset.score,
        pdf_resolved: false,
        storage_path: learning?.last_storage_path ?? null,
      };
      await s.storage.from(BUCKET).upload(marker, new Blob([JSON.stringify(payload)], { type: "application/json" }), { contentType: "application/json", upsert: true });
      const next = rememberAsset(recordObservation(learning, config.retailer, status, checkedAt, resolved.asset.url), fingerprint, resolved.asset.url);
      await writeLearning(s, next);
      return NextResponse.json({ ok: true, ...payload, learning: next });
    }

    const pdf = resolved.pdf;
    const bytesLength = pdf.bytes.byteLength;
    const sha256 = createHash("sha256").update(pdf.bytes).digest("hex");
    const fingerprint = `pdf:${sha256}`;
    const claim = await claimAssetMarker(s, config.retailer, fingerprint, resolved.asset.url, checkedAt);
    claimedMarkerPath = claim.path;
    claimedMarkerIsNew = claim.isNew;
    if (!reprocess && !claim.isNew) {
      const payload = { checked_at: checkedAt, visited_url: config.sourcePage, retailer: config.retailer, status: "unchanged" as const, manual, asset_url: resolved.asset.url, asset_fingerprint: fingerprint, viewer_url: pdf.viewer_url, pdf_url: pdf.url, sha256, storage_path: learning?.last_storage_path ?? null };
      await s.storage.from(BUCKET).upload(marker, new Blob([JSON.stringify(payload)], { type: "application/json" }), { contentType: "application/json", upsert: true });
      const next = rememberAsset(recordObservation(learning, config.retailer, "unchanged", checkedAt, resolved.asset.url), fingerprint, resolved.asset.url, learning?.last_storage_path);
      await writeLearning(s, next);
      return NextResponse.json({ ok: true, ...payload, learning: next });
    }

    const shortSha = sha256.slice(0, 16);
    const { data: existing } = await s.storage.from(BUCKET).list(String(config.retailer), { search: shortSha, limit: 20 });
    const found = (existing || []).find((x: any) => x.name?.includes(shortSha));
    if (found) {
      const storagePath = `${config.retailer}/${found.name}`;
      const processing = await processIfNeeded(s, config, storagePath, pdf.bytes, pdf.url, reprocess);
      const payload = { checked_at: checkedAt, visited_url: config.sourcePage, retailer: config.retailer, status: "unchanged" as const, manual, reprocess, asset_url: resolved.asset.url, asset_fingerprint: fingerprint, viewer_url: pdf.viewer_url, pdf_url: pdf.url, sha256, storage_path: storagePath, processing };
      await s.storage.from(BUCKET).upload(marker, new Blob([JSON.stringify(payload)], { type: "application/json" }), { contentType: "application/json", upsert: true });
      const next = rememberAsset(recordObservation(learning, config.retailer, "unchanged", checkedAt, resolved.asset.url), fingerprint, resolved.asset.url, storagePath);
      await writeLearning(s, next);
      return NextResponse.json({ ok: true, ...payload, learning: next });
    }

    const filename = `${config.retailer}-${todayPrague()}__${shortSha}.pdf`;
    const storagePath = `${config.retailer}/${filename}`;
    const { error: uploadError } = await s.storage.from(BUCKET).upload(storagePath, pdf.bytes, { contentType: "application/pdf", upsert: false, cacheControl: "3600" });
    if (uploadError) {
      if (/already exists/i.test(uploadError.message)) {
        const processing = await processIfNeeded(s, config, storagePath, pdf.bytes, pdf.url, reprocess);
        const payload = { checked_at: checkedAt, visited_url: config.sourcePage, retailer: config.retailer, status: "unchanged" as const, manual, asset_url: resolved.asset.url, asset_fingerprint: fingerprint, viewer_url: pdf.viewer_url, pdf_url: pdf.url, sha256, storage_path: storagePath, processing };
        await s.storage.from(BUCKET).upload(marker, new Blob([JSON.stringify(payload)], { type: "application/json" }), { contentType: "application/json", upsert: true });
        const next = rememberAsset(recordObservation(learning, config.retailer, "unchanged", checkedAt, resolved.asset.url), fingerprint, resolved.asset.url, storagePath);
        await writeLearning(s, next);
        return NextResponse.json({ ok: true, ...payload, learning: next });
      }
      throw new Error(`Storage upload: ${uploadError.message}`);
    }

    const processing = await processIfNeeded(s, config, storagePath, pdf.bytes, pdf.url, true);
    const payload = { checked_at: checkedAt, visited_url: config.sourcePage, retailer: config.retailer, status: "downloaded" as const, manual, asset_url: resolved.asset.url, asset_fingerprint: fingerprint, viewer_url: pdf.viewer_url, pdf_url: pdf.url, sha256, bytes: bytesLength, storage_path: storagePath, processing };
    await s.storage.from(BUCKET).upload(marker, new Blob([JSON.stringify(payload)], { type: "application/json" }), { contentType: "application/json", upsert: true });
    const next = rememberAsset(recordObservation(learning, config.retailer, "downloaded", checkedAt, resolved.asset.url), fingerprint, resolved.asset.url, storagePath);
    await writeLearning(s, next);
    return NextResponse.json({ ok: true, ...payload, learning: next });
  } catch (error) {
    if (claimedMarkerIsNew && claimedMarkerPath) {
      try { await s.storage.from(BUCKET).remove([claimedMarkerPath]); } catch {}
    }
    const message = error instanceof Error ? error.message : String(error);
    const payload = { checked_at: checkedAt, visited_url: config.sourcePage, retailer: config.retailer, status: "error" as const, manual, error: message };
    await s.storage.from(BUCKET).upload(marker, new Blob([JSON.stringify(payload)], { type: "application/json" }), { contentType: "application/json", upsert: true });
    const next = recordObservation(learning, config.retailer, "error", checkedAt, config.sourcePage);
    await writeLearning(s, next);
    console.error(`[${config.retailer}-leaflet-cron]`, message);
    return NextResponse.json({ ok: false, ...payload, learning: next }, { status: 502 });
  }
}
