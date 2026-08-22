import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { runGenericLeafletConnector } from "@/lib/leaflet-monitor/generic-fetcher";
import { captureCurrentLeafletOrigin } from "@/lib/leaflet-monitor/origin-capture";
import { ingestViewerPages } from "@/lib/leaflet-monitor/viewer-processing";
import { resolveViewerPageManifest } from "@/lib/leaflet-monitor/page-manifest";
import { processLeafletPdf } from "@/lib/leaflet-review/processor";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

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

async function storePdf(supabase: any, path: string, bytes: Uint8Array) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    cacheControl: "3600",
    upsert: false,
  });
  if (!error || /already exists|duplicate|resource exists/i.test(error.message || "")) return { stored: true as const };
  if (!/maximum allowed size|exceeded|too large|payload too large/i.test(error.message || "")) {
    throw new Error(`Lidl PDF upload: ${error.message}`);
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

async function recoverLidlPdf(supabase: any, assetUrl: string) {
  const manifest = await resolveViewerPageManifest("lidl", assetUrl);
  const wanted = normalized(manifest.identifier);
  const pdfUrl = manifest.pdf_urls.find((url) => normalized(decodeURIComponent(url)).includes(wanted)) ?? null;
  if (!pdfUrl) return null;

  const response = await fetch(pdfUrl, { cache: "no-store", redirect: "follow" });
  if (!response.ok) throw new Error(`Lidl PDF fallback HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Lidl PDF fallback nevrátil PDF.");

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const shortSha = sha256.slice(0, 16);
  const { data: existing, error: existingError } = await supabase
    .from("leaflet_documents")
    .select("id,storage_path,filename,processing_status,approved_count,created_at")
    .eq("retailer_id", "lidl")
    .ilike("filename", `%${shortSha}%`)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(`Lidl PDF lookup: ${existingError.message}`);

  let storagePath = existing?.storage_path ? String(existing.storage_path) : "";
  let storageMode: "supabase" | "remote_pdf" = storagePath.includes("/remote-") ? "remote_pdf" : "supabase";
  let storageWarning: string | null = null;

  if (!storagePath) {
    const filename = `lidl-${todayPrague()}__${shortSha}.pdf`;
    const wantedPath = `lidl/${filename}`;
    const stored = await storePdf(supabase, wantedPath, bytes);
    if (stored.stored) {
      storagePath = wantedPath;
      storageMode = "supabase";
    } else {
      storagePath = `lidl/remote-${shortSha}.pdf`;
      storageMode = "remote_pdf";
      storageWarning = stored.reason;
    }
  }

  const alreadyReady = existing && ["ready_for_review", "partially_reviewed", "completed"].includes(String(existing.processing_status));
  const processing = alreadyReady
    ? existing
    : await processLeafletPdf({
        supabase,
        bucket: BUCKET,
        path: storagePath,
        retailer: "lidl",
        sourceUrl: pdfUrl,
        bytes,
        force: false,
      });

  return {
    pdf_url: pdfUrl,
    sha256,
    bytes: bytes.byteLength,
    storage_path: storagePath,
    storage_mode: storageMode,
    storage_warning: storageWarning,
    duplicate_prevented: Boolean(existing),
    processing,
  };
}

export async function runLeafletConnectorWithOrigin(req: Request, config: ConnectorConfig) {
  const response = await runGenericLeafletConnector(req, config);
  if (!response.ok) return response;

  let payload: Record<string, unknown>;
  try {
    payload = await response.clone().json() as Record<string, unknown>;
  } catch {
    return response;
  }

  const status = typeof payload.status === "string" ? payload.status : "";
  if (!CAPTURE_STATUSES.has(status)) return response;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ...payload, ok: false, origin_error: "Supabase není nakonfigurovaný." }, { status: 503 });
  }

  try {
    const origin = await captureCurrentLeafletOrigin(supabase, config.retailer);
    const assetUrl = typeof payload.asset_url === "string" ? payload.asset_url : origin.asset_url;
    if (!assetUrl && VIEWER_RETAILERS.has(config.retailer)) throw new Error("Viewer retailer nemá asset_url pro zpracování.");

    let pdf_fallback: unknown = null;
    let page_processing: unknown = null;

    if (config.retailer === "lidl" && assetUrl) {
      pdf_fallback = await recoverLidlPdf(supabase, assetUrl);
    }

    if (VIEWER_RETAILERS.has(config.retailer) && assetUrl && !pdf_fallback) {
      page_processing = await ingestViewerPages(supabase, config.retailer, assetUrl);
    }

    return NextResponse.json({
      ...payload,
      ...(pdf_fallback ? {
        pdf_resolved: true,
        pdf_url: (pdf_fallback as any).pdf_url,
        sha256: (pdf_fallback as any).sha256,
        storage_path: (pdf_fallback as any).storage_path,
        storage_mode: (pdf_fallback as any).storage_mode,
        processing: (pdf_fallback as any).processing,
      } : {}),
      origin,
      pdf_fallback,
      page_processing,
    });
  } catch (error) {
    return NextResponse.json({
      ...payload,
      ok: false,
      origin_error: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}
