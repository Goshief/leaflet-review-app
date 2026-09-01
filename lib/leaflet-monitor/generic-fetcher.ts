import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { processLeafletPdf } from "@/lib/leaflet-review/processor";
import { discoverLeafletAssets, type LeafletAsset } from "@/lib/leaflet-monitor/discovery";
import { recordObservation, shouldVisitRetailer, type CheckStatus, type RetailerId, type RetailerLearningState } from "@/lib/leaflet-monitor/learning";
import {
  buildWatchCheckLog,
  canonicalLeafletUrl,
  findDuplicateLeaflet,
  identityFromAsset,
  identityFromDocument,
  type LeafletIdentity,
  selectWatchableAssets,
} from "@/lib/leaflet-monitor/leaflet-identity";
import {
  applyWatcherNextCheck,
  getWatcherIntervalHours,
  isWatchedRetailer,
  isWatcherCheckDue,
  WATCHER_ASSET_LIMIT,
} from "@/lib/leaflet-monitor/watcher-config";
import {
  createSupabasePdfIntakeBackend,
  ingestOriginalPdf,
  recordDownloadFailure,
  type PdfIntakeResult,
} from "@/lib/leaflet-monitor/pdf-intake";
import { ensurePagesAfterDownloadAndParse } from "@/lib/leaflet-monitor/page-parser";

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
  return canonicalLeafletUrl(retailer, rawUrl);
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

async function resolveAsset(asset: LeafletAsset): Promise<{ asset: LeafletAsset; pdf: PdfHit | null }> {
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

async function resolveSelectedAsset(sourceHtml: string, sourceUrl: string, retailer: RetailerId): Promise<{ asset: LeafletAsset; pdf: PdfHit | null }> {
  const asset = discoverLeafletAssets(sourceHtml, sourceUrl, retailer)[0];
  if (!asset) throw new Error("Na webu obchodu nebyl nalezen žádný důvěryhodný aktuální letákový asset.");
  return resolveAsset(asset);
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
async function canonicalDocumentByHash(s:any,retailer:RetailerId,shortSha:string){
  const {data,error}=await s.from("leaflet_documents")
    .select("id,storage_path,filename,created_at,processing_status,approved_count")
    .eq("retailer_id",retailer)
    .ilike("filename",`%${shortSha}%`)
    .order("created_at",{ascending:true})
    .limit(1)
    .maybeSingle();
  if(error)throw new Error(`leaflet hash lookup: ${error.message}`);
  return data??null;
}

async function loadKnownIdentities(s: any, retailer: RetailerId): Promise<LeafletIdentity[]> {
  const { data, error } = await s
    .from("leaflet_documents")
    .select("source_url,source_leaflet_number,valid_from,valid_to,filename")
    .eq("retailer_id", retailer)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(`leaflet identity lookup: ${error.message}`);
  return (data ?? []).map((row: any) => identityFromDocument(retailer, row));
}

function checkLogPath(retailer: RetailerId, checkedAt: string) {
  return `_checks/${retailer}-${checkedAt.replace(/[:.]/g, "-")}.json`;
}

async function writeCheckLogs(s: any, retailer: RetailerId, checkedAt: string, payload: Record<string, unknown>) {
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const latest = `_checks/${retailer}-${todayPrague()}.json`;
  const history = checkLogPath(retailer, checkedAt);
  await s.storage.from(BUCKET).upload(latest, blob, { contentType: "application/json", upsert: true });
  await s.storage.from(BUCKET).upload(history, blob, { contentType: "application/json", upsert: true });
}

function withWatcherSchedule(state: RetailerLearningState, retailer: RetailerId, checkedAt: string): RetailerLearningState {
  const next = applyWatcherNextCheck(retailer, checkedAt);
  return next ? { ...state, next_check_at: next } : state;
}

type PdfIngestResult = {
  status: "downloaded" | "unchanged";
  duplicate_prevented?: boolean;
  identity: LeafletIdentity;
  asset_url: string;
  asset_fingerprint: string;
  viewer_url: string;
  pdf_url: string;
  sha256: string;
  storage_path: string | null;
  pdf_storage_path?: string | null;
  pdf_intake?: unknown;
  page_split?: unknown;
  processing: unknown;
  claimedMarkerPath: string | null;
  claimedMarkerIsNew: boolean;
};

async function splitPagesIfNeeded(s: any, archive: PdfIntakeResult, bytes: Uint8Array) {
  if (!archive.batch_id || archive.status === "download_failed") return null;
  try {
    return await ensurePagesAfterDownloadAndParse(s, archive, bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[leaflet-pdf-pages]", message);
    return { pages: [], batch_status: "pages_failed" as const, error: message };
  }
}

async function ingestResolvedPdf(
  s: any,
  config: Config,
  pdf: PdfHit,
  checkedAt: string,
  reprocess: boolean,
): Promise<PdfIngestResult> {
  const bytesLength = pdf.bytes.byteLength;
  const sha256 = createHash("sha256").update(pdf.bytes).digest("hex");
  const shortSha = sha256.slice(0, 16);
  const fingerprint = `pdf:${sha256}`;
  const identity = identityFromAsset(config.retailer, pdf.asset, {
    pdf_url: pdf.url,
    content_hash: sha256,
  });
  const archive = await ingestOriginalPdf(createSupabasePdfIntakeBackend(s), {
    store_id: config.retailer,
    source_url: config.sourcePage,
    pdf_source_url: pdf.url,
    bytes: pdf.bytes,
    content_type: "application/pdf",
    valid_from: identity.valid_from,
    valid_to: identity.valid_to,
    downloaded_at: checkedAt,
  });
  const pageSplit = await splitPagesIfNeeded(s, archive, pdf.bytes);
  const archived = pageSplit?.batch_status
    ? { ...archive, status: pageSplit.batch_status }
    : archive;
  const claim = await claimAssetMarker(s, config.retailer, fingerprint, pdf.asset.url, checkedAt);
  const base = {
    identity,
    asset_url: pdf.asset.url,
    asset_fingerprint: fingerprint,
    viewer_url: pdf.viewer_url,
    pdf_url: pdf.url,
    sha256,
    pdf_storage_path: archived.pdf_storage_path,
    pdf_intake: archived,
    page_split: pageSplit,
    claimedMarkerPath: claim.path,
    claimedMarkerIsNew: claim.isNew,
  };

  const skipNewImport = archive.status === "duplicate" && !reprocess;

  const canonical = await canonicalDocumentByHash(s, config.retailer, shortSha);
  if (canonical?.storage_path || skipNewImport) {
    const storagePath = canonical?.storage_path ? String(canonical.storage_path) : archive.pdf_storage_path;
    const processing = reprocess && storagePath
      ? await processIfNeeded(s, config, storagePath, pdf.bytes, pdf.url, true)
      : canonical;
    return { ...base, status: "unchanged", duplicate_prevented: true, storage_path: storagePath, processing };
  }

  if (!reprocess && !claim.isNew) {
    return { ...base, status: "unchanged", duplicate_prevented: true, storage_path: archive.pdf_storage_path, processing: null };
  }

  const { data: existing } = await s.storage.from(BUCKET).list(String(config.retailer), { search: shortSha, limit: 20 });
  const found = (existing || []).find((x: any) => x.name?.includes(shortSha));
  if (found) {
    const storagePath = `${config.retailer}/${found.name}`;
    const processing = await processIfNeeded(s, config, storagePath, pdf.bytes, pdf.url, reprocess);
    return { ...base, status: "unchanged", duplicate_prevented: true, storage_path: storagePath, processing };
  }

  const filename = `${config.retailer}-${todayPrague()}__${shortSha}.pdf`;
  const storagePath = `${config.retailer}/${filename}`;
  const { error: uploadError } = await s.storage.from(BUCKET).upload(storagePath, pdf.bytes, { contentType: "application/pdf", upsert: false, cacheControl: "3600" });
  if (uploadError) {
    if (/already exists/i.test(uploadError.message)) {
      const processing = await processIfNeeded(s, config, storagePath, pdf.bytes, pdf.url, reprocess);
      return { ...base, status: "unchanged", duplicate_prevented: true, storage_path: storagePath, processing };
    }
    throw new Error(`Storage upload: ${uploadError.message}`);
  }

  const processing = archive.created_import || reprocess
    ? await processIfNeeded(s, config, storagePath, pdf.bytes, pdf.url, true)
    : null;
  void bytesLength;
  return { ...base, status: "downloaded", storage_path: storagePath, processing };
}

async function runWatchedLeafletWatch(s: any, config: Config, learning: RetailerLearningState | null, manual: boolean, reprocess: boolean) {
  const checkedAt = new Date().toISOString();
  const errors: string[] = [];
  let claimedMarkerPath: string | null = null;
  let claimedMarkerIsNew = false;
  const sourceUrl = config.sourcePage;

  try {
    const known = await loadKnownIdentities(s, config.retailer);
    const source = await fetchWithTimeout(config.sourcePage);
    if (!source.ok) throw new Error(`${config.retailer} source HTTP ${source.status}`);
    const sourceHtml = await source.text();
    const discovered = selectWatchableAssets(
      config.retailer,
      discoverLeafletAssets(sourceHtml, source.url || config.sourcePage, config.retailer),
      WATCHER_ASSET_LIMIT,
    );
    const leaflets: Array<Record<string, unknown>> = [];
    const newViewerAssets: string[] = [];
    let newCount = 0;
    let lastPdf: PdfIngestResult | null = null;
    let lastAssetUrl: string | null = discovered[0]?.url ?? null;
    let lastFingerprint: string | null = null;
    let lastKind: string | null = discovered[0]?.kind ?? null;
    let lastStorage = learning?.last_storage_path ?? null;

    for (const asset of discovered) {
      const preIdentity = identityFromAsset(config.retailer, asset);
      lastAssetUrl = asset.url;
      lastKind = asset.kind;
      if (!reprocess && findDuplicateLeaflet(known, preIdentity)) {
        leaflets.push({ status: "unchanged", asset_url: asset.url, reason: "identity", identity: preIdentity });
        continue;
      }
      try {
        const resolved = await resolveAsset(asset);
        if (!resolved.pdf) {
          const failure = await recordDownloadFailure(createSupabasePdfIntakeBackend(s), {
            store_id: config.retailer,
            source_url: config.sourcePage,
            pdf_source_url: resolved.asset.url,
            error: "Letákový zdroj nevrátil originální PDF.",
            valid_from: preIdentity.valid_from,
            valid_to: preIdentity.valid_to,
          });
          errors.push(`${resolved.asset.url}: ${failure.error_message || "PDF se nepodařilo stáhnout"}`);
          const fingerprint = viewerFingerprint(config.retailer, resolved.asset.url);
          lastFingerprint = fingerprint;
          leaflets.push({
            status: "download_failed",
            asset_url: resolved.asset.url,
            asset_fingerprint: fingerprint,
            asset_kind: resolved.asset.kind,
            pdf_resolved: false,
            identity: preIdentity,
            pdf_intake: failure,
          });
          newViewerAssets.push(resolved.asset.url);
          continue;
        }

        const ingest = await ingestResolvedPdf(s, config, resolved.pdf, checkedAt, reprocess);
        lastPdf = ingest;
        lastFingerprint = ingest.asset_fingerprint;
        if (ingest.storage_path) lastStorage = ingest.storage_path;
        claimedMarkerPath = ingest.claimedMarkerPath;
        claimedMarkerIsNew = ingest.claimedMarkerIsNew;
        if (ingest.status === "downloaded") {
          known.push(ingest.identity);
          newCount += 1;
        } else if (!findDuplicateLeaflet(known, ingest.identity)) {
          known.push(ingest.identity);
        }
        leaflets.push({
          status: ingest.status,
          duplicate_prevented: ingest.duplicate_prevented ?? false,
          asset_url: ingest.asset_url,
          asset_fingerprint: ingest.asset_fingerprint,
          viewer_url: ingest.viewer_url,
          pdf_url: ingest.pdf_url,
          sha256: ingest.sha256,
          storage_path: ingest.storage_path,
          pdf_storage_path: ingest.pdf_storage_path ?? null,
          processing: ingest.processing,
          identity: ingest.identity,
          pdf_intake: ingest.pdf_intake ?? null,
          page_split: ingest.page_split ?? null,
        });
        claimedMarkerIsNew = false;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${asset.url}: ${message}`);
        try {
          await recordDownloadFailure(createSupabasePdfIntakeBackend(s), {
            store_id: config.retailer,
            source_url: config.sourcePage,
            pdf_source_url: asset.url,
            error: message,
            valid_from: preIdentity.valid_from,
            valid_to: preIdentity.valid_to,
          });
        } catch {}
        if (claimedMarkerIsNew && claimedMarkerPath) {
          try { await s.storage.from(BUCKET).remove([claimedMarkerPath]); } catch {}
        }
        claimedMarkerIsNew = false;
        claimedMarkerPath = null;
      }
    }

    const downloadedAny = leaflets.some((row) => row.status === "downloaded");
    const assetFoundAny = leaflets.some((row) => row.status === "asset_found");
    const observationStatus: CheckStatus = downloadedAny ? "downloaded" : assetFoundAny ? "asset_found" : "unchanged";
    const check = buildWatchCheckLog({
      retailer: config.retailer,
      checked_at: checkedAt,
      source_url: sourceUrl,
      found_leaflets_count: discovered.length,
      new_leaflets_count: newCount,
      errors,
    });
    const payload = {
      ...check,
      status: observationStatus,
      manual,
      reprocess,
      visited_url: sourceUrl,
      asset_url: lastPdf?.asset_url ?? lastAssetUrl,
      asset_fingerprint: lastFingerprint,
      asset_kind: lastKind,
      pdf_resolved: Boolean(lastPdf),
      viewer_url: lastPdf?.viewer_url ?? null,
      pdf_url: lastPdf?.pdf_url ?? null,
      sha256: lastPdf?.sha256 ?? null,
      storage_path: lastStorage,
      processing: lastPdf?.processing ?? null,
      leaflets,
      new_viewer_assets: newViewerAssets,
    };
    await writeCheckLogs(s, config.retailer, checkedAt, payload);
    let next = recordObservation(learning, config.retailer, observationStatus, checkedAt, lastPdf?.asset_url ?? lastAssetUrl);
    if (lastPdf) next = rememberAsset(next, lastPdf.asset_fingerprint, lastPdf.asset_url, lastStorage);
    else if (lastFingerprint && lastAssetUrl) next = rememberAsset(next, lastFingerprint, lastAssetUrl, lastStorage);
    next = withWatcherSchedule(next, config.retailer, checkedAt);
    await writeLearning(s, next);
    return NextResponse.json({ ok: true, ...payload, learning: next });
  } catch (error) {
    if (claimedMarkerIsNew && claimedMarkerPath) {
      try { await s.storage.from(BUCKET).remove([claimedMarkerPath]); } catch {}
    }
    const message = error instanceof Error ? error.message : String(error);
    const check = buildWatchCheckLog({
      retailer: config.retailer,
      checked_at: checkedAt,
      source_url: sourceUrl,
      found_leaflets_count: 0,
      new_leaflets_count: 0,
      errors: [message],
    });
    const payload = { ...check, status: "error" as const, manual, visited_url: sourceUrl, error: message };
    try { await writeCheckLogs(s, config.retailer, checkedAt, payload); } catch {}
    try {
      const next = withWatcherSchedule(recordObservation(learning, config.retailer, "error", checkedAt, config.sourcePage), config.retailer, checkedAt);
      await writeLearning(s, next);
      console.error(`[${config.retailer}-leaflet-cron]`, message);
      return NextResponse.json({ ok: false, ...payload, learning: next }, { status: 502 });
    } catch {
      console.error(`[${config.retailer}-leaflet-cron]`, message);
      return NextResponse.json({ ok: false, ...payload }, { status: 502 });
    }
  }
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
  const watched = isWatchedRetailer(config.retailer);
  if (!manual && watched) {
    const intervalHours = getWatcherIntervalHours();
    const decision = isWatcherCheckDue(learning?.last_check_at, new Date(), intervalHours);
    if (!decision.due) {
      return NextResponse.json({
        ok: true,
        status: "interval_skip",
        retailer: config.retailer,
        checked_at: new Date().toISOString(),
        source_url: config.sourcePage,
        found_leaflets_count: 0,
        new_leaflets_count: 0,
        errors: [],
        reason: decision.reason,
        next_check_at: decision.next_check_at,
        interval_hours: intervalHours,
      });
    }
  }
  if (watched) {
    return runWatchedLeafletWatch(s, config, learning, manual, reprocess);
  }
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
      const failure = await recordDownloadFailure(createSupabasePdfIntakeBackend(s), {
        store_id: config.retailer,
        source_url: config.sourcePage,
        pdf_source_url: resolved.asset.url,
        error: "Letákový zdroj nevrátil originální PDF.",
      });
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
        pdf_intake: failure,
      };
      await s.storage.from(BUCKET).upload(marker, new Blob([JSON.stringify(payload)], { type: "application/json" }), { contentType: "application/json", upsert: true });
      const next = rememberAsset(recordObservation(learning, config.retailer, status, checkedAt, resolved.asset.url), fingerprint, resolved.asset.url);
      await writeLearning(s, next);
      return NextResponse.json({ ok: true, ...payload, learning: next });
    }

    const pdf = resolved.pdf;
    const bytesLength = pdf.bytes.byteLength;
    const sha256 = createHash("sha256").update(pdf.bytes).digest("hex");
    const shortSha = sha256.slice(0, 16);
    const fingerprint = `pdf:${sha256}`;
    const archive = await ingestOriginalPdf(createSupabasePdfIntakeBackend(s), {
      store_id: config.retailer,
      source_url: config.sourcePage,
      pdf_source_url: pdf.url,
      bytes: pdf.bytes,
      content_type: "application/pdf",
      downloaded_at: checkedAt,
    });
    const pageSplit = await splitPagesIfNeeded(s, archive, pdf.bytes);
    const claim = await claimAssetMarker(s, config.retailer, fingerprint, resolved.asset.url, checkedAt);
    claimedMarkerPath = claim.path;
    claimedMarkerIsNew = claim.isNew;

    // SHA is the identity of a PDF leaflet. A date in the filename is only metadata.
    // Always reuse the oldest canonical document so reviewed/approved work can never
    // be split into a second document for the same PDF bytes.
    const canonical=await canonicalDocumentByHash(s,config.retailer,shortSha);
    if(canonical?.storage_path || (archive.status === "duplicate" && !reprocess)){
      const storagePath=canonical?.storage_path?String(canonical.storage_path):archive.pdf_storage_path;
      const processing=reprocess && storagePath?await processIfNeeded(s,config,storagePath,pdf.bytes,pdf.url,true):canonical;
      const payload={checked_at:checkedAt,visited_url:config.sourcePage,retailer:config.retailer,status:"unchanged" as const,manual,reprocess,duplicate_prevented:true,canonical_document_id:canonical?.id??null,asset_url:resolved.asset.url,asset_fingerprint:fingerprint,viewer_url:pdf.viewer_url,pdf_url:pdf.url,sha256,storage_path:storagePath,pdf_storage_path:archive.pdf_storage_path,pdf_intake:archive,page_split:pageSplit,processing};
      await s.storage.from(BUCKET).upload(marker,new Blob([JSON.stringify(payload)],{type:"application/json"}),{contentType:"application/json",upsert:true});
      const next=rememberAsset(recordObservation(learning,config.retailer,"unchanged",checkedAt,resolved.asset.url),fingerprint,resolved.asset.url,storagePath);
      await writeLearning(s,next);
      return NextResponse.json({ok:true,...payload,learning:next});
    }

    if (!reprocess && !claim.isNew) {
      const payload = { checked_at: checkedAt, visited_url: config.sourcePage, retailer: config.retailer, status: "unchanged" as const, manual, asset_url: resolved.asset.url, asset_fingerprint: fingerprint, viewer_url: pdf.viewer_url, pdf_url: pdf.url, sha256, storage_path: learning?.last_storage_path ?? null };
      await s.storage.from(BUCKET).upload(marker, new Blob([JSON.stringify(payload)], { type: "application/json" }), { contentType: "application/json", upsert: true });
      const next = rememberAsset(recordObservation(learning, config.retailer, "unchanged", checkedAt, resolved.asset.url), fingerprint, resolved.asset.url, learning?.last_storage_path);
      await writeLearning(s, next);
      return NextResponse.json({ ok: true, ...payload, learning: next });
    }

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

    const processing = archive.created_import || reprocess
      ? await processIfNeeded(s, config, storagePath, pdf.bytes, pdf.url, true)
      : null;
    const payload = { checked_at: checkedAt, visited_url: config.sourcePage, retailer: config.retailer, status: "downloaded" as const, manual, asset_url: resolved.asset.url, asset_fingerprint: fingerprint, viewer_url: pdf.viewer_url, pdf_url: pdf.url, sha256, bytes: bytesLength, storage_path: storagePath, pdf_storage_path: archive.pdf_storage_path, pdf_intake: archive, page_split: pageSplit, processing };
    await s.storage.from(BUCKET).upload(marker, new Blob([JSON.stringify(payload)], { type: "application/json" }), { contentType: "application/json", upsert: true });
    const next = rememberAsset(recordObservation(learning, config.retailer, "downloaded", checkedAt, resolved.asset.url), fingerprint, resolved.asset.url, storagePath);
    await writeLearning(s, next);
    return NextResponse.json({ ok: true, ...payload, learning: next });
  } catch (error) {
    if (claimedMarkerIsNew && claimedMarkerPath) {
      try { await s.storage.from(BUCKET).remove([claimedMarkerPath]); } catch {}
    }
    const message = error instanceof Error ? error.message : String(error);
    try {
      await recordDownloadFailure(createSupabasePdfIntakeBackend(s), {
        store_id: config.retailer,
        source_url: config.sourcePage,
        pdf_source_url: config.sourcePage,
        error: message,
      });
    } catch {}
    const payload = { checked_at: checkedAt, visited_url: config.sourcePage, retailer: config.retailer, status: "error" as const, manual, error: message };
    await s.storage.from(BUCKET).upload(marker, new Blob([JSON.stringify(payload)], { type: "application/json" }), { contentType: "application/json", upsert: true });
    const next = recordObservation(learning, config.retailer, "error", checkedAt, config.sourcePage);
    await writeLearning(s, next);
    console.error(`[${config.retailer}-leaflet-cron]`, message);
    return NextResponse.json({ ok: false, ...payload, learning: next }, { status: 502 });
  }
}
