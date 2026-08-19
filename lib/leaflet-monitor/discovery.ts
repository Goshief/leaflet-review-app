import type { RetailerId } from "@/lib/leaflet-monitor/learning";

export type LeafletAsset = {
  url: string;
  label: string;
  kind: "pdf" | "viewer";
  score: number;
};

const NEGATIVE = /udržitelnost|udrzitelnost|výroční|vyrocni|privacy|soukrom|přístupnost|pristupnost|compliance|whistle|kariér|karier|dodavatel|media|tiskov/i;
const LEAFLET = /leták|letak|leaflet|brožur|brozur|katalog|catalog|prohlédnout|prohlednout|prolistovat|akční|akcni|nabídk|nabidk/i;

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
}

function links(html: string, base: string) {
  const out: Array<{ url: string; label: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = decodeHtml(match[1] || "");
    const label = decodeHtml((match[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    try { out.push({ url: new URL(raw, base).toString(), label }); } catch {}
  }
  return out;
}

function dateScore(url: string, today: Date) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const d = today.getUTCDate();
  const text = decodeURIComponent(url).toLowerCase();
  let score = 0;
  if (text.includes(String(y))) score += 5;
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  if (text.includes(`${dd}_${mm}_${y}`) || text.includes(`${dd}-${mm}-${y}`)) score += 12;
  return score;
}

function retailerScore(retailer: RetailerId, url: string, label: string) {
  const hay = `${label} ${url}`;
  if (NEGATIVE.test(hay)) return -1000;
  let score = LEAFLET.test(hay) ? 20 : 0;
  if (/\.pdf(?:$|[?#])/i.test(url)) score += 6;
  if (retailer === "lidl") {
    if (/lidl\.cz\/l\/cs\/letak\//i.test(url)) score += 80;
    if (/lidl\.cz\/c\/akcni-letak/i.test(url)) score += 35;
    if (/do letáku|prolistovat brožuru|akční leták/i.test(label)) score += 30;
  } else if (retailer === "penny") {
    if (/files\.rewe\.co\.at\/PennyIntLeaflet\/CZ\//i.test(url)) score += 100;
    if (/prohlédnout/i.test(label)) score += 30;
  } else if (retailer === "kaufland") {
    if (/leaflets\.kaufland\.com|assets\.leaflets\.schwarz|\/letak/i.test(url)) score += 70;
  } else if (retailer === "billa") {
    if (/view\.publitas\.com\/billa-cz|billa\.cz\/letaky/i.test(url)) score += 70;
    if (/stáhnout pdf|velký leták|aktuální leták/i.test(label)) score += 30;
  }
  return score;
}

export function discoverLeafletAssets(html: string, base: string, retailer: RetailerId, now = new Date()): LeafletAsset[] {
  const seen = new Set<string>();
  const candidates: LeafletAsset[] = [];
  for (const link of links(html, base)) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    const score = retailerScore(retailer, link.url, link.label) + dateScore(link.url, now);
    if (score <= 0) continue;
    candidates.push({
      url: link.url,
      label: link.label,
      kind: /\.pdf(?:$|[?#])/i.test(link.url) ? "pdf" : "viewer",
      score,
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}
