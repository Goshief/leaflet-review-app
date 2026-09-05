import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { runGenericLeafletConnector } from "@/lib/leaflet-monitor/generic-fetcher";
import { captureCurrentLeafletOrigin } from "@/lib/leaflet-monitor/origin-capture";
import { ingestViewerPages } from "@/lib/leaflet-monitor/viewer-processing";
import { resolveViewerPageManifest } from "@/lib/leaflet-monitor/page-manifest";
import { processLeafletPdf } from "@/lib/leaflet-review/processor";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";
import { createSupabasePdfIntakeBackend, ingestOriginalPdf } from "@/lib/leaflet-monitor/pdf-intake";
import { ensurePagesAfterDownloadAndParse } from "@/lib/leaflet-monitor/page-parser";
import { identityFromAsset } from "@/lib/leaflet-monitor/leaflet-identity";

type ConnectorConfig = {
  retailer: RetailerId;
  sourcePage: string;
  cronSchedule: string;
  preferredLabels: RegExp[];
  autoProcess?: boolean;
};

const BUCKET = "leaflet-intake";
const TUS_CHUNK = 6 * 1024 * 1024;
const CAPTURE_STATUSES = new Set(["downloaded", "unchanged", "asset_found"]);
const VIEWER_RETAILERS = new Set<RetailerId>(["lidl", "kaufland", "penny"]);
const SCHWARZ_RETAILERS = new Set<RetailerId>(["lidl", "kaufland"]);

function todayPrague() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function normalized(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function b64(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

function isTrustedViewerUrl(retailer: RetailerId, url: string) {
  if (retailer === "lidl") return /lidl\.cz\/l\/cs\/letak\/[^/]+\/view\/flyer/i.test(url);
  if (retailer === "kaufland") return /leaflets\.kaufland\.com\/cz-CZ\/[^/]+\/ar\/[^/?#]+/i.test(url);
  if (retailer === "penny") return /files\.rewe\.co\.at\/PennyIntLeaflet\/CZ\/[^/?#]+/i.test(url);
  return false;
}

function viewerUrlsFromPayload(payload: Record<string, unknown>, retailer: RetailerId) {
  const urls: string[] = [];
  if (Array.isArray(payload.new_viewer_assets)) {
    for (const value of payload.new_viewer_assets) {
      if (typeof value === "string" && isTrustedViewerUrl(retailer, value)) urls.push(value);
    }
  }
  if (typeof payload.asset_url === "string" && isTrustedViewerUrl(retailer, payload.asset_url)) {
    urls.push(payload.asset_url);
  }
  return [...new Set(urls)];
}

async function uploadResumable(path: string, bytes: Uint8Array) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Supabase TUS není nakonfigurovaný.");

  const create = await fetch(`${base}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "tus-resumable": "1.0.0",
      "upload-length": String(bytes.byteLength),
      "upload-metadata": [
        `bucketName ${b64(BUCKET)}`,
        `objectName ${b64(path)}`,
        `contentType ${b64("application/pdf")}`,
        `cacheControl ${b64("3600")}`,
      ].join(","),
      "x-upsert": "false",
    },
  });
  if (!create.ok) throw new Error(`Supabase TUS create ${create.status}: ${(await create.text()).slice(0, 300)}`);
  const location = create.headers.get("location");
  if (!location) throw new Error("Supabase TUS nevrátil Location.");
  const uploadUrl = new URL(location, base).toString();

  let offset = 0;
  while (offset < bytes.byteLength) {
    const end = Math.min(bytes.byteLength, offset + TUS_CHUNK);
    const chunk = bytes.slice(offset, end);
    let lastError = "";
    let advanced = false;
    for (let attempt = 0; attempt < 3 && !advanced; attempt++) {
      const patch = await fetch(uploadUrl, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${key}`,
          "tus-resumable": "1.0.0",
          "upload-offset": String(offset),
          "content-type": "application/offset+octet-stream",
        },
        body: chunk,
      });
      if (patch.ok) {
        const next = Number(patch.headers.get("upload-offset") ?? end);
        offset = Number.isFinite(next) && next > offset ? next : end;
        advanced = true;
        break;
      }
      lastError = `${patch.status}: ${(await patch.text()).slice(0, 300)}`;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    if (!advanced) throw new Error(`Supabase TUS chunk ${offset}: ${lastError}`);
  }
}

async function storePdf(supabase: any, retailer: RetailerId, path: string, bytes: Uint8Array) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    cacheControl: "3600",
    upsert: false,
  });
  if (!error || /already exists|duplicate|resource exists/i.test(error.message || "")) return { stored: true as const };
  if (!/maximum allowed size|exceeded|too large|payload too large/i.test(error.message || "")) {
    throw new Error(`${retailer} PDF upload: ${error.message}`);
  }
  try {
    await uploadResumable(path, bytes);
    return { stored: true as const };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/413|maximum size exceeded|too large|payload too large/i.test(message)) {
      return { stored: false as const, reason: message };
    }
    throw cause;
  }
}

async function recoverSchwarzPdf(supabase: any, retailer: RetailerId, assetUrl: string) {
  if (!SCHWARZ_RETAILERS.has(retailer)) return null;
  const manifest = await resolveViewerPageManifest(retailer, assetUrl);
  const wanted = normalized(manifest.identifier);
  const candidates = manifest.pdf_urls.filter((url) => {
    const decoded = normalized(decodeURIComponent(url));
    return decoded.includes(wanted) || wanted.includes(decoded.split("-").slice(-4).join("-"));
  });
  const pdfUrl = candidates[0] ?? manifest.pdf_urls[0] ?? null;
  if (!pdfUrl) return null;

  const response = await fetch(pdfUrl, { cache: "no-store", redirect: "follow" });
  if (!response.ok) throw new Error(`${retailer} PDF fallback HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error(`${retailer} PDF fallback nevrátil PDF.`);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const shortSha = sha256.slice(0, 16);
  const identity = identityFromAsset(retailer, { url: assetUrl, label: assetUrl, kind: "viewer" }, { pdf_url: pdfUrl, content_hash: sha256 });
  const archive = await ingestOriginalPdf(createSupabasePdfIntakeBackend(supabase), {
    store_id: retailer,
    source_url: assetUrl,
    pdf_source_url: pdfUrl,
    bytes,
    content_type: "application/pdf",
    valid_from: identity.valid_from,
    valid_to: identity.valid_to,
  });

  let page_split: unknown = null;
  try {
    page_split = await ensurePagesAfterDownloadAndParse(supabase, archive, bytes);
  } catch (error) {
    page_split = { pages: [], batch_status: "pages_failed", error: error instanceof Error ? error.message : String(error) };
  }

  const { data: existing, error: existingError } = await supabase
    .from("leaflet_documents")
    .select("id,storage_path,filename,processing_status,approved_count,created_at,valid_from,valid_to")
    .eq("retailer_id", retailer)
    .ilike("filename", `%${shortSha}%`)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(`${retailer} PDF lookup: ${existingError.message}`);

  let storagePath = existing?.storage_path ? String(existing.storage_path) : "";
  let storageMode: "supabase" | "remote_pdf" = storagePath.includes("/remote-") ? "remote_pdf" : "supabase";
  let storageWarning: string | null = null;

  if (!storagePath) {
    const filename = `${retailer}-${todayPrague()}__${shortSha}.pdf`;
    const wantedPath = `${retailer}/${filename}`;
    const stored = await storePdf(supabase, retailer, wantedPath, bytes);
    if (stored.stored) {
      storagePath = wantedPath;
      storageMode = "supabase";
    } else {
      storagePath = `${retailer}/remote-${shortSha}.pdf`;
      storageMode = "remote_pdf";
      storageWarning = stored.reason;
    }
  }

  const alreadyReady = existing && ["ready_for_review", "partially_reviewed", "completed"].includes(String(existing.processing_status));
  const processing = archive.status === "duplicate"
    ? existing ?? null
    : alreadyReady
      ? existing
      : await processLeafletPdf({
          supabase,
          bucket: BUCKET,
          path: storagePath,
          retailer,
          sourceUrl: pdfUrl,
          bytes,
          force: false,
        });

  // The viewer URL carries the authoritative validity range for Lidl/Kaufland.
  if (identity.valid_from && identity.valid_to && storagePath) {
    await supabase
      .from("leaflet_documents")
      .update({ valid_from: identity.valid_from, valid_to: identity.valid_to, source_leaflet_number: manifest.identifier })
      .eq("retailer_id", retailer)
      .eq("storage_bucket", BUCKET)
      .eq("storage_path", storagePath);
  }

  return {
    retailer,
    viewer_url: assetUrl,
    identifier: manifest.identifier,
    valid_from: identity.valid_from,
    valid_to: identity.valid_to,
    pdf_url: pdfUrl,
    sha256,
    bytes: bytes.byteLength,
    storage_path: storagePath,
    pdf_storage_path: archive.pdf_storage_path,
    storage_mode: storageMode,
    storage_warning: storageWarning,
    duplicate_prevented: Boolean(existing) || archive.status === "duplicate",
    pdf_intake: archive,
    page_split,
    processing,
  };
}

export async function runLeafletConnectorWithOrigin(req: Request, config: ConnectorConfig) {
  const response = await runGenericLeafletConnector(req, config);

  let payload: Record<string, unknown>;
  try {
    payload = await response.clone().json() as Record<string, unknown>;
  } catch {
    return response;
  }

  const status = typeof payload.status === "string" ? payload.status : "";
  const viewerUrls = VIEWER_RETAILERS.has(config.retailer) ? viewerUrlsFromPayload(payload, config.retailer) : [];
  const hasViewerFallback = viewerUrls.length > 0;
  if (!response.ok && !hasViewerFallback) return response;
  if (!CAPTURE_STATUSES.has(status) && !hasViewerFallback) return response;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ...payload, ok: false, origin_error: "Supabase není nakonfigurovaný." }, { status: 503 });
  }

  let origin: unknown = null;
  let originError: string | null = null;
  try {
    origin = await captureCurrentLeafletOrigin(supabase, config.retailer);
  } catch (error) {
    originError = error instanceof Error ? error.message : String(error);
  }

  try {
    const recovered: unknown[] = [];
    const pageResults: unknown[] = [];
    const fallbackErrors: Array<{ url: string; error: string }> = [];

    for (const url of viewerUrls) {
      try {
        if (SCHWARZ_RETAILERS.has(config.retailer)) {
          const pdf = await recoverSchwarzPdf(supabase, config.retailer, url);
          if (pdf) recovered.push(pdf);
          else {
            const pageResult = await ingestViewerPages(supabase, config.retailer, url);
            if (pageResult) pageResults.push(pageResult);
          }
        } else if (config.retailer === "penny") {
          const pageResult = await ingestViewerPages(supabase, config.retailer, url);
          if (pageResult) pageResults.push(pageResult);
        }
      } catch (error) {
        fallbackErrors.push({ url, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const primary = recovered[0] as any;
    const fallbackSucceeded = recovered.length > 0 || pageResults.length > 0;
    const ok = response.ok || fallbackSucceeded;

    return NextResponse.json({
      ...payload,
      ok,
      ...(primary ? {
        status: primary.duplicate_prevented ? "unchanged" : "downloaded",
        pdf_resolved: true,
        pdf_url: primary.pdf_url,
        sha256: primary.sha256,
        storage_path: primary.storage_path,
        storage_mode: primary.storage_mode,
        processing: primary.processing,
        valid_from: primary.valid_from,
        valid_to: primary.valid_to,
      } : {}),
      origin,
      origin_error: originError,
      viewer_recovery: recovered,
      page_processing: pageResults,
      fallback_errors: fallbackErrors,
    }, { status: ok ? 200 : response.status });
  } catch (error) {
    return NextResponse.json({
      ...payload,
      ok: false,
      origin,
      origin_error: originError,
      fallback_error: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
