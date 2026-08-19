import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";
import { discoverLeafletAssets } from "@/lib/leaflet-monitor/discovery";
import { resolveViewerPageManifest } from "@/lib/leaflet-monitor/page-manifest";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

export const runtime = "nodejs";
export const maxDuration = 120;

const USER_AGENT = "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";
const SUPPORTED = new Set<RetailerId>(["lidl", "kaufland"]);

async function fetchHtml(url: string) {
  const response = await fetch(url, { redirect: "follow", cache: "no-store", headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.8" } });
  if (!response.ok) throw new Error(`source HTTP ${response.status}`);
  return { html: await response.text(), finalUrl: response.url || url };
}

function inferPageCount(bytes: Uint8Array) {
  const text = Buffer.from(bytes).toString("latin1");
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 1000);
  const pageObjects = [...text.matchAll(/\/Type\s*\/Page\b/g)].length;
  return {
    page_tree_count: counts.length ? Math.max(...counts) : null,
    page_object_count: pageObjects || null,
    count_candidates: [...new Set(counts)].sort((a, b) => a - b),
  };
}

async function pdfJsPageCount(bytes: Uint8Array) {
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = {
    WorkerMessageHandler: worker.WorkerMessageHandler,
  };
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  try {
    return doc.numPages;
  } finally {
    await doc.destroy();
  }
}

async function verifyPdf(url: string) {
  const response = await fetch(url, { redirect: "follow", cache: "no-store", headers: { "User-Agent": USER_AGENT, Accept: "application/pdf,*/*;q=0.8" } });
  if (!response.ok) throw new Error(`PDF HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (signature !== "%PDF-") throw new Error(`Odkaz nevrátil PDF: ${response.headers.get("content-type") || "unknown"}`);
  let pdfjs_page_count: number | null = null;
  let pdfjs_error: string | null = null;
  try {
    pdfjs_page_count = await pdfJsPageCount(bytes);
  } catch (error) {
    pdfjs_error = error instanceof Error ? error.message : String(error);
  }
  return {
    url: response.url || url,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...inferPageCount(bytes),
    pdfjs_page_count,
    pdfjs_error,
    content_type: response.headers.get("content-type"),
    signature,
  };
}

export async function GET(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;
  const retailer = new URL(req.url).searchParams.get("retailer") as RetailerId | null;
  if (!retailer || !SUPPORTED.has(retailer)) return NextResponse.json({ ok: false, error: "retailer must be lidl or kaufland" }, { status: 400 });

  try {
    const config = getRetailerConfig(retailer);
    const source = await fetchHtml(config.fetch_url);
    const asset = discoverLeafletAssets(source.html, source.finalUrl, retailer)[0];
    if (!asset) throw new Error("Aktuální viewer nebyl nalezen.");
    const manifest = await resolveViewerPageManifest(retailer, asset.url);
    if (!manifest.pdf_urls.length) throw new Error("Manifest neobsahuje žádné PDF URL.");

    const attempts = [];
    for (const pdfUrl of manifest.pdf_urls.slice(0, 5)) {
      try {
        const verified = await verifyPdf(pdfUrl);
        attempts.push({ ok: true, ...verified });
        if (verified.pdfjs_page_count === manifest.page_count || verified.page_tree_count === manifest.page_count || verified.page_object_count === manifest.page_count) {
          return NextResponse.json({ ok: true, retailer, manifest_page_count: manifest.page_count, selected: verified, attempts });
        }
      } catch (error) {
        attempts.push({ ok: false, url: pdfUrl, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return NextResponse.json({ ok: false, retailer, manifest_page_count: manifest.page_count, error: "Žádné PDF nemá stejný počet stran jako manifest.", attempts }, { status: 422 });
  } catch (error) {
    return NextResponse.json({ ok: false, retailer, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
