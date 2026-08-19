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

function canonicalPage(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
  } catch { return url; }
}

function isSelfLink(url: string, base: string) {
  return canonicalPage(url) === canonicalPage(base);
}

function dateScore(textValue: string, today: Date) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const d = today.getUTCDate();
  const text = decodeURIComponent(textValue).toLowerCase();
  let score = text.includes(String(y)) ? 5 : 0;
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  if (text.includes(`${dd}_${mm}_${y}`) || text.includes(`${dd}-${mm}-${y}`)) score += 12;
  const range = text.match(/(\d{1,2})[._\-/ ]+(\d{1,2})[^\d]{0,20}(\d{1,2})[._\-/ ]+(\d{1,2})[._\-/ ]+(20\d{2})/);
  if (range) {
    const start = Date.UTC(Number(range[5]), Number(range[2]) - 1, Number(range[1]));
    const end = Date.UTC(Number(range[5]), Number(range[4]) - 1, Number(range[3]), 23, 59, 59);
    const current = Date.UTC(y, m - 1, d, 12);
    if (current >= start && current <= end) score += 35;
  }
  return score;
}

function retailerScore(retailer: RetailerId, url: string, label: string) {
  const hay = `${label} ${url}`;
  if (NEGATIVE.test(hay)) return -1000;
  let score = LEAFLET.test(hay) ? 20 : 0;
  const isPdf = /\.pdf(?:$|[?#])/i.test(url);
  if (isPdf) score += 20;
  if (retailer === "lidl") {
    if (/lidl\.cz\/l\/cs\/letak\//i.test(url)) score += 100;
    if (/lidl\.cz\/c\/akcni-letak/i.test(url)) score += 25;
    if (/do letáku|prolistovat brožuru|akční leták/i.test(label)) score += 30;
  } else if (retailer === "penny") {
    if (/files\.rewe\.co\.at\/PennyIntLeaflet\/CZ\//i.test(url)) score += 120;
    if (/prohlédnout/i.test(label)) score += 30;
  } else if (retailer === "kaufland") {
    if (/leaflets\.kaufland\.com\/cz-CZ\//i.test(url)) score += 120;
    if (/assets\.leaflets\.schwarz/i.test(url)) score += 140;
    if (/Akční nabídka/i.test(label)) score += 35;
    if (/Spotřební zboží|Vyvážený nákup/i.test(label)) score -= 15;
  } else if (retailer === "billa") {
    if (/view\.publitas\.com\/.*\.pdf/i.test(url)) score += 160;
    else if (/view\.publitas\.com\/billa-cz/i.test(url)) score += 120;
    if (/stáhnout pdf|velký leták|aktuální leták/i.test(label)) score += 40;
  }
  return score;
}

export function discoverLeafletAssets(html: string, base: string, retailer: RetailerId, now = new Date()): LeafletAsset[] {
  const seen = new Set<string>();
  const candidates: LeafletAsset[] = [];
  for (const link of links(html, base)) {
    if (isSelfLink(link.url, base) || seen.has(link.url)) continue;
    seen.add(link.url);
    const score = retailerScore(retailer, link.url, link.label) + dateScore(`${link.label} ${link.url}`, now);
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
