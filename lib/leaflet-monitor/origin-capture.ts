import { createHash } from "node:crypto";
import { discoverLeafletAssets } from "@/lib/leaflet-monitor/discovery";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

const BUCKET = "leaflet-intake";
const USER_AGENT = "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";

async function fetchBytes(url: string) {
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
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const signature = new TextDecoder().decode(bytes.slice(0, 5));
    const isPdf = contentType.includes("application/pdf") || signature === "%PDF-";
    return { response, bytes, contentType, isPdf };
  } finally {
    clearTimeout(timer);
  }
}

function todayPrague() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export type OriginCaptureResult = {
  retailer: RetailerId;
  status: "stored" | "already_stored";
  asset_url: string;
  final_url: string;
  origin_kind: "pdf" | "html_snapshot";
  origin_sha256: string;
  origin_bytes: number;
  origin_content_type: string;
  storage_path: string;
};

export async function captureCurrentLeafletOrigin(supabase: any, retailerId: RetailerId): Promise<OriginCaptureResult> {
  const retailer = getRetailerConfig(retailerId);
  const source = await fetchBytes(retailer.fetch_url);
  if (!source.response.ok) throw new Error(`${retailerId} source HTTP ${source.response.status}`);
  if (!source.contentType.includes("text/html")) throw new Error(`${retailerId} source is not HTML`);

  const sourceHtml = new TextDecoder().decode(source.bytes);
  const asset = discoverLeafletAssets(sourceHtml, source.response.url || retailer.fetch_url, retailerId)[0];
  if (!asset) throw new Error("Nebyl nalezen důvěryhodný aktuální letákový asset.");

  const origin = await fetchBytes(asset.url);
  if (!origin.response.ok) throw new Error(`${retailerId} asset HTTP ${origin.response.status}`);
  if (!origin.isPdf && !origin.contentType.includes("text/html")) {
    throw new Error(`Nepodporovaný typ originálu: ${origin.contentType}`);
  }

  const sha256 = createHash("sha256").update(origin.bytes).digest("hex");
  const shortSha = sha256.slice(0, 16);

  if (origin.isPdf) {
    const { data: document } = await supabase
      .from("leaflet_documents")
      .select("storage_path,filename")
      .eq("retailer_id", retailerId)
      .ilike("filename", `%${shortSha}%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (document?.storage_path) {
      return {
        retailer: retailerId,
        status: "already_stored",
        asset_url: asset.url,
        final_url: origin.response.url,
        origin_kind: "pdf",
        origin_sha256: sha256,
        origin_bytes: origin.bytes.byteLength,
        origin_content_type: origin.contentType,
        storage_path: document.storage_path,
      };
    }

    const storagePath = `${retailerId}/origin/${todayPrague()}__${shortSha}.pdf`;
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, origin.bytes, {
      contentType: "application/pdf",
      cacheControl: "31536000",
      upsert: false,
    });
    if (error && !/already exists|duplicate|resource exists/i.test(error.message || "")) {
      throw new Error(`Storage upload: ${error.message}`);
    }
    return {
      retailer: retailerId,
      status: error ? "already_stored" : "stored",
      asset_url: asset.url,
      final_url: origin.response.url,
      origin_kind: "pdf",
      origin_sha256: sha256,
      origin_bytes: origin.bytes.byteLength,
      origin_content_type: origin.contentType,
      storage_path: storagePath,
    };
  }

  const envelope = {
    version: 1,
    retailer: retailerId,
    captured_at: new Date().toISOString(),
    asset_url: asset.url,
    final_url: origin.response.url,
    origin_content_type: origin.contentType,
    origin_sha256: sha256,
    origin_bytes: origin.bytes.byteLength,
    encoding: "base64" as const,
    payload: Buffer.from(origin.bytes).toString("base64"),
  };
  const storagePath = `${retailerId}/origin/${todayPrague()}__${shortSha}.origin.json`;
  const { error } = await supabase.storage.from(BUCKET).upload(
    storagePath,
    new Blob([JSON.stringify(envelope)], { type: "application/json" }),
    { contentType: "application/json", cacheControl: "31536000", upsert: false },
  );
  if (error && !/already exists|duplicate|resource exists/i.test(error.message || "")) {
    throw new Error(`Storage upload: ${error.message}`);
  }

  return {
    retailer: retailerId,
    status: error ? "already_stored" : "stored",
    asset_url: asset.url,
    final_url: origin.response.url,
    origin_kind: "html_snapshot",
    origin_sha256: sha256,
    origin_bytes: origin.bytes.byteLength,
    origin_content_type: origin.contentType,
    storage_path: storagePath,
  };
}
