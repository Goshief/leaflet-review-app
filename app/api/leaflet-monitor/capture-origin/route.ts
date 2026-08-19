import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";
import { discoverLeafletAssets } from "@/lib/leaflet-monitor/discovery";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "leaflet-intake";
const USER_AGENT = "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";
const SUPPORTED = new Set<RetailerId>(["billa", "lidl", "kaufland", "penny"]);

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

async function capture(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const requestUrl = new URL(req.url);
  const raw = requestUrl.searchParams.get("retailer") as RetailerId | null;
  if (!raw || !SUPPORTED.has(raw)) {
    return NextResponse.json({ ok: false, error: "retailer must be one of billa, lidl, kaufland, penny" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });
  const retailer = getRetailerConfig(raw);

  try {
    const source = await fetchBytes(retailer.fetch_url);
    if (!source.response.ok) throw new Error(`${raw} source HTTP ${source.response.status}`);
    if (!source.contentType.includes("text/html")) throw new Error(`${raw} source is not HTML`);

    const sourceHtml = new TextDecoder().decode(source.bytes);
    const asset = discoverLeafletAssets(sourceHtml, source.response.url || retailer.fetch_url, raw)[0];
    if (!asset) throw new Error("Nebyl nalezen důvěryhodný aktuální letákový asset.");

    const origin = await fetchBytes(asset.url);
    if (!origin.response.ok) throw new Error(`${raw} asset HTTP ${origin.response.status}`);
    if (!origin.isPdf && !origin.contentType.includes("text/html")) {
      throw new Error(`Nepodporovaný typ originálu: ${origin.contentType}`);
    }

    const sha256 = createHash("sha256").update(origin.bytes).digest("hex");
    const shortSha = sha256.slice(0, 16);

    if (origin.isPdf) {
      const { data: document } = await supabase
        .from("leaflet_documents")
        .select("storage_path,filename")
        .eq("retailer_id", raw)
        .ilike("filename", `%${shortSha}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (document?.storage_path) {
        return NextResponse.json({
          ok: true,
          retailer: raw,
          status: "already_stored",
          asset_url: asset.url,
          final_url: origin.response.url,
          origin_kind: "pdf",
          origin_sha256: sha256,
          origin_bytes: origin.bytes.byteLength,
          origin_content_type: origin.contentType,
          storage_path: document.storage_path,
        });
      }

      const storagePath = `${raw}/origin/${todayPrague()}__${shortSha}.pdf`;
      const { error } = await supabase.storage.from(BUCKET).upload(storagePath, origin.bytes, {
        contentType: "application/pdf",
        cacheControl: "31536000",
        upsert: false,
      });
      if (error && !/already exists|duplicate|resource exists/i.test(error.message || "")) {
        throw new Error(`Storage upload: ${error.message}`);
      }
      return NextResponse.json({
        ok: true,
        retailer: raw,
        status: error ? "already_stored" : "stored",
        asset_url: asset.url,
        final_url: origin.response.url,
        origin_kind: "pdf",
        origin_sha256: sha256,
        origin_bytes: origin.bytes.byteLength,
        origin_content_type: origin.contentType,
        storage_path: storagePath,
      });
    }

    const envelope = {
      version: 1,
      retailer: raw,
      captured_at: new Date().toISOString(),
      asset_url: asset.url,
      final_url: origin.response.url,
      origin_content_type: origin.contentType,
      origin_sha256: sha256,
      origin_bytes: origin.bytes.byteLength,
      encoding: "base64" as const,
      payload: Buffer.from(origin.bytes).toString("base64"),
    };
    const storagePath = `${raw}/origin/${todayPrague()}__${shortSha}.origin.json`;
    const { error } = await supabase.storage.from(BUCKET).upload(
      storagePath,
      new Blob([JSON.stringify(envelope)], { type: "application/json" }),
      { contentType: "application/json", cacheControl: "31536000", upsert: false },
    );
    if (error && !/already exists|duplicate|resource exists/i.test(error.message || "")) {
      throw new Error(`Storage upload: ${error.message}`);
    }

    return NextResponse.json({
      ok: true,
      retailer: raw,
      status: error ? "already_stored" : "stored",
      asset_url: asset.url,
      final_url: origin.response.url,
      origin_kind: "html_snapshot",
      origin_sha256: sha256,
      origin_bytes: origin.bytes.byteLength,
      origin_content_type: origin.contentType,
      storage_path: storagePath,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      retailer: raw,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  }
}

export const GET = capture;
export const POST = capture;
