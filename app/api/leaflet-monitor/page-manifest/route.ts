import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";
import { discoverLeafletAssets } from "@/lib/leaflet-monitor/discovery";
import { resolveViewerPageManifest, validatePageManifest } from "@/lib/leaflet-monitor/page-manifest";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

export const runtime = "nodejs";
export const maxDuration = 60;

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

export async function GET(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const retailer = new URL(req.url).searchParams.get("retailer") as RetailerId | null;
  if (!retailer || !SUPPORTED.has(retailer)) {
    return NextResponse.json({ ok: false, error: "retailer must be lidl, kaufland or penny" }, { status: 400 });
  }

  try {
    const config = getRetailerConfig(retailer);
    const source = await fetchHtml(config.fetch_url);
    const asset = discoverLeafletAssets(source.html, source.finalUrl, retailer)[0];
    if (!asset) throw new Error("Nebyl nalezen aktuální viewer asset.");
    const manifest = await resolveViewerPageManifest(retailer, asset.url);
    const validation = validatePageManifest(manifest);
    const textPages = manifest.pages.filter((p) => p.text.trim().length > 0).length;
    const imagePages = manifest.pages.filter((p) => Boolean(p.image_url)).length;
    const minText = Math.min(...manifest.pages.map((p) => p.text.length));
    const maxText = Math.max(...manifest.pages.map((p) => p.text.length));
    return NextResponse.json({
      ok: validation.ok,
      retailer,
      identifier: manifest.identifier,
      viewer_url: manifest.viewer_url,
      page_count: manifest.page_count,
      expected_sequence: manifest.pages.map((p) => p.page_no),
      text_pages: textPages,
      image_pages: imagePages,
      pdf_urls: manifest.pdf_urls,
      min_text_length: minText,
      max_text_length: maxText,
      validation,
      first: manifest.pages[0],
      middle: manifest.pages[Math.floor(manifest.pages.length / 2)],
      last: manifest.pages[manifest.pages.length - 1],
    }, { status: validation.ok ? 200 : 422 });
  } catch (error) {
    return NextResponse.json({ ok: false, retailer, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
