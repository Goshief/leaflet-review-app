import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";
import { discoverLeafletAssets } from "@/lib/leaflet-monitor/discovery";
import { resolveViewerPageManifest, validatePageManifest } from "@/lib/leaflet-monitor/page-manifest";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "leaflet-intake";
const USER_AGENT = "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";
const SUPPORTED = new Set<RetailerId>(["lidl", "kaufland", "penny"]);

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.8", "Accept-Language": "cs-CZ,cs;q=0.9" },
  });
  if (!response.ok) throw new Error(`source HTTP ${response.status}`);
  return { html: await response.text(), finalUrl: response.url || url };
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

async function store(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const retailer = new URL(req.url).searchParams.get("retailer") as RetailerId | null;
  if (!retailer || !SUPPORTED.has(retailer)) {
    return NextResponse.json({ ok: false, error: "retailer must be lidl, kaufland or penny" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });

  try {
    const config = getRetailerConfig(retailer);
    const source = await fetchHtml(config.fetch_url);
    const asset = discoverLeafletAssets(source.html, source.finalUrl, retailer)[0];
    if (!asset) throw new Error("Nebyl nalezen aktuální viewer asset.");

    const manifest = await resolveViewerPageManifest(retailer, asset.url);
    const validation = validatePageManifest(manifest);
    if (!validation.ok) throw new Error(`Manifest není validní: ${validation.errors.join("; ")}`);

    const payload = stableJson({ version: 1, ...manifest });
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const shortSha = sha256.slice(0, 16);
    const safeIdentifier = manifest.identifier.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
    const storagePath = `${retailer}/manifests/${safeIdentifier}__${shortSha}.json`;

    const { error } = await supabase.storage.from(BUCKET).upload(
      storagePath,
      new Blob([payload], { type: "application/json" }),
      { contentType: "application/json", cacheControl: "31536000", upsert: false },
    );
    if (error && !/already exists|duplicate|resource exists/i.test(error.message || "")) {
      throw new Error(`Storage upload: ${error.message}`);
    }

    const { data: downloaded, error: downloadError } = await supabase.storage.from(BUCKET).download(storagePath);
    if (downloadError || !downloaded) throw new Error(`Storage read-back: ${downloadError?.message || "missing object"}`);
    const storedText = await downloaded.text();
    const storedSha256 = createHash("sha256").update(storedText).digest("hex");
    if (storedSha256 !== sha256) throw new Error(`Manifest SHA mismatch: expected ${sha256}, got ${storedSha256}`);

    return NextResponse.json({
      ok: true,
      retailer,
      status: error ? "already_stored" : "stored",
      identifier: manifest.identifier,
      page_count: manifest.page_count,
      manifest_sha256: sha256,
      stored_sha256: storedSha256,
      bytes: Buffer.byteLength(payload),
      storage_path: storagePath,
      validation,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, retailer, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

export const GET = store;
export const POST = store;
