import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const maxDuration = 60;

const GROUP = "billa-cz";
const CURRENT_PUBLICATION_ID = 2709538;

export async function GET(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;
  const wanted = Number(new URL(req.url).searchParams.get("publication") || CURRENT_PUBLICATION_ID);
  try {
    const listRes = await fetch(`https://api.publitas.com/v1/groups/${GROUP}/publications.json`, { cache: "no-store" });
    const listText = await listRes.text();
    if (!listRes.ok) throw new Error(`Publitas list HTTP ${listRes.status}: ${listText.slice(0,500)}`);
    const list = JSON.parse(listText) as Array<{ id?: number; slug?: string; title?: string; browserTitle?: string; onlineAt?: string; url?: string }>;
    const hit = list.find((p) => Number(p.id) === wanted);
    if (!hit?.url) return NextResponse.json({ ok: false, publication_id: wanted, found: false, recent: list.slice(0,10) }, { status: 404 });

    const pubRes = await fetch(hit.url, { cache: "no-store" });
    const pubText = await pubRes.text();
    if (!pubRes.ok) throw new Error(`Publitas publication HTTP ${pubRes.status}: ${pubText.slice(0,500)}`);
    const pub = JSON.parse(pubText) as any;
    const pages: Array<any> = [];
    let pageNo = 0;
    for (const spread of Array.isArray(pub?.spreads) ? pub.spreads : []) {
      const pagePaths = Array.isArray(spread?.pages) ? spread.pages : [];
      const hotspots = Array.isArray(spread?.hotspots) ? spread.hotspots : [];
      for (let i = 0; i < pagePaths.length; i++) {
        pageNo++;
        const pagePath = String(pagePaths[i] || "");
        const pageHotspots = hotspots.filter((h: any) => {
          const hp = Number(h?.page ?? h?.pageNumber ?? h?.page_number);
          return !Number.isFinite(hp) || hp === pageNo || hp === i || hp === i + 1;
        });
        pages.push({
          page_no: pageNo,
          image_base: pagePath,
          image_url: pagePath ? `https://view.publitas.com${pagePath}-at1600.jpg` : null,
          hotspot_count: pageHotspots.length,
          hotspots: pageHotspots.slice(0,50),
        });
      }
    }
    return NextResponse.json({
      ok: true,
      publication: hit,
      sizes: pub?.sizes ?? null,
      spread_count: Array.isArray(pub?.spreads) ? pub.spreads.length : 0,
      page_count: pages.length,
      page1: pages[0] ?? null,
      page2: pages[1] ?? null,
      total_hotspots: pages.reduce((sum,p)=>sum+Number(p.hotspot_count||0),0),
      top_level_keys: Object.keys(pub || {}),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, publication_id: wanted, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
