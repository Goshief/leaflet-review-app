import type { RetailerId } from "./learning";

export type LeafletAsset = {
  url: string;
  label: string;
  kind: "pdf" | "viewer";
  score: number;
};

const NEGATIVE = /udržitelnost|udrzitelnost|výroční|vyrocni|privacy|soukrom|přístupnost|pristupnost|compliance|whistle|kariér|karier|dodavatel|media|tiskov|osobních\s+údaj|osobnich\s+udaj|ochran[ae]?\s+osobn|gdpr|cookies?|zásad[ay]|zasad[ay]|podmínk|podmink|reklamační|reklamacni|reklamační\s+řád|reklamacni\s+rad|obchodní\s+podmín|obchodni\s+podmin|informace-o-zpracovani|zpracovani-a-ochrane/i;
const LEAFLET = /leták|letak|leaflet|brožur|brozur|katalog|catalog|prohlédnout|prohlednout|prolistovat|akční|akcni|nabídk|nabidk/i;
const VIEWER_HOST = /(?:publitas\.com|leaflets\.kaufland\.com|files\.rewe\.co\.at|letak\.tetadrogerie\.cz|ecpaper|leaflet)/i;

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
}
function safeDecodeUri(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}
function plainText(value: string) {
  return decodeHtml(value).replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function links(html: string, base: string) {
  const out: Array<{ url: string; label: string }> = [];
  const seen = new Set<string>();
  const add = (rawValue: string, label = "") => {
    const raw = decodeHtml(rawValue || "");
    try {
      const url = new URL(raw, base).toString();
      if (/\.(?:jpe?g|png|gif|webp|svg|ico)(?:$|[?#])/i.test(url)) return;
      const cleanLabel = plainText(label);
      const key = `${url}\n${cleanLabel}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ url, label: cleanLabel });
    } catch {}
  };

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const index = match.index ?? 0;
    // Retailer cards often keep title/validity next to the link rather than inside it.
    // Carry a small surrounding text window so identityFromAsset can parse the dates.
    const context = plainText(html.slice(Math.max(0, index - 700), Math.min(html.length, index + match[0].length + 300)));
    add(match[1] || "", `${match[2] || ""} ${context}`);
  }

  // Some leaflet sites place the viewer in an iframe or in a JS/data attribute rather
  // than a normal anchor. Only accept values that already look leaflet/viewer-related.
  for (const match of html.matchAll(/(?:src|data-url|data-href|data-link|viewerUrl|viewer_url)["']?\s*[:=]\s*["']([^"']+)["']/gi)) {
    const raw = match[1] || "";
    const decoded = decodeHtml(raw);
    if (!LEAFLET.test(decoded) && !VIEWER_HOST.test(decoded) && !/\.pdf(?:$|[?#])/i.test(decoded)) continue;
    const index = match.index ?? 0;
    const context = plainText(html.slice(Math.max(0, index - 500), Math.min(html.length, index + match[0].length + 250)));
    add(raw, `viewer ${context}`);
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
  const text = safeDecodeUri(textValue).toLowerCase();
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
  const hay = `${label} ${safeDecodeUri(url)}`;
  if (NEGATIVE.test(hay)) return -1000;
  let score = LEAFLET.test(hay) ? 20 : 0;
  const isPdf = /\.pdf(?:$|[?#])/i.test(url);
  if (isPdf) score += 20;
  if (retailer === "lidl") {
    if (/lidl\.cz\/l\/cs\/letak\//i.test(url)) score += 100;
    if (/lidl\.cz\/c\/akcni-letak/i.test(url)) score += 25;
    if (/do letáku|prolistovat brožuru|akční leták/i.test(label)) score += 30;
    if (/lidl\.cz\/(?:user-api|c\/(?:whatsapp|ctvrtecni-nabidka|vikendova-nabidka|pondelni-nabidka))/i.test(url)) score -= 80;
  } else if (retailer === "penny") {
    if (/files\.rewe\.co\.at\/PennyIntLeaflet\/CZ\//i.test(url)) score += 160;
    if (/prohlédnout/i.test(label)) score += 30;
    if (/penny\.cz\/nabidky\/?$/i.test(url)) return -1000;
  } else if (retailer === "kaufland") {
    if (/leaflets\.kaufland\.com\/cz-CZ\//i.test(url)) score += 160;
    if (/assets\.leaflets\.schwarz/i.test(url)) score += 180;
    if (/Akční nabídka/i.test(label)) score += 35;
    if (/Spotřební zboží|Vyvážený nákup/i.test(label)) score -= 15;
    if (/prodejny\.kaufland\.cz\/(?:nabidka|aktualne\/servis)\//i.test(url)) score -= 80;
  } else if (retailer === "billa") {
    if (/view\.publitas\.com\/.*\.pdf/i.test(url)) score += 160;
    else if (/view\.publitas\.com\/billa-cz/i.test(url)) score += 120;
    if (/stáhnout pdf|velký leták|aktuální leták/i.test(label)) score += 40;
  } else if (retailer === "globus") {
    if (/globus\.cz\/globus\/letaky\/akcni-letak-/i.test(url)) score += 180;
    if (/globus\.cz\/globus\/letaky\/aktualni/i.test(url)) score += 120;
    if (/globus\.cz\/(?!globus\/)[^/]+\/letaky\/?(?:[?#].*)?$/i.test(url)) return -1000;
  } else if (retailer === "rossmann") {
    if (/rossmann\.cz\/obsah\/[^/]*-pdf-[^/]*\/akcni-letak/i.test(url)) score += 240;
    if (/rossmann\.cz\/obsah\/publitas\/.*akcni-letak/i.test(url)) score += 120;
    if (/rossmann\.cz\/prihlaseni|adform\.net/i.test(url)) return -1000;
  } else if (retailer === "teta") {
    if (/letak\.tetadrogerie\.cz\//i.test(url)) score += 220;
    if (/tetadrogerie\.cz\/akce\/letak/i.test(url)) score += 80;
    if (/zobrazit leták|zobrazit letak/i.test(label)) score += 50;
  } else if (retailer === "albert") {
    if (/supermarket.*leták|supermarket.*letak|hypermarket.*leták|hypermarket.*letak/i.test(hay)) score += 100;
    if (/aktuální-letáky|aktualni-letaky/i.test(url)) score += 20;
  } else if (retailer === "tesco") {
    if (/akcni-nabidky\/letaky-a-katalogy/i.test(url)) score += 60;
    if (/prohlédnout on-line|stáhnout|stahnout|akční leták|akcni letak/i.test(label)) score += 80;
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
