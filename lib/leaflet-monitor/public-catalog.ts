import { createHash } from "node:crypto";
import { discoverLeafletAssets } from "./discovery.ts";

export const CATALOG_RETAILERS = ["albert", "billa", "globus", "kaufland", "lidl", "penny", "rossmann", "tesco", "teta"] as const;
export type CatalogRetailer = typeof CATALOG_RETAILERS[number];
export const CATALOG_SOURCE_URLS: Record<CatalogRetailer, string> = {
  albert: "https://www.albert.cz/aktualni-letaky",
  billa: "https://www.billa.cz/letaky-billa/velky-letak",
  globus: "https://www.globus.cz/globus/letaky",
  kaufland: "https://endpoints.leaflets.schwarz/v4/overview?client_locale=kaufland/cs-CZ&store_id=1000",
  lidl: "https://endpoints.leaflets.schwarz/v4/overview?client_locale=lidl/cs-CZ&region_id=0",
  penny: "https://www.penny.cz/nabidky/letaky",
  rossmann: "https://www.rossmann.cz/obsah/akce-a-letaky",
  tesco: "https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy",
  teta: "https://www.tetadrogerie.cz/akce/letak",
};
export const MAX_CATALOG_PDF_BYTES = 75 * 1024 * 1024;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const PDF_HOSTS: Record<CatalogRetailer, readonly string[]> = {
  albert: ["view.publitas.com"], billa: ["view.publitas.com"],
  globus: ["gapi.globus.cz"], kaufland: ["assets.leaflets.schwarz"], lidl: ["assets.leaflets.schwarz"],
  penny: ["files.rewe.co.at"], rossmann: ["www.rossmann.cz", "view.publitas.com"],
  tesco: ["digitalcontent.api.tesco.com"], teta: ["liveecpaperdmp.blob.core.windows.net"],
};
const SOURCE_HOSTS = new Set([...Object.values(CATALOG_SOURCE_URLS).map(u => new URL(u).hostname), ...Object.values(PDF_HOSTS).flat(), "www.tesco.cz", "letak.tetadrogerie.cz", "letaky.albert.cz", "imgproxy.leaflets.schwarz"]);

export type CatalogLeaflet = {
  retailerId: CatalogRetailer; internalLeafletKey: string; storagePath: string;
  filename: string; sourceUrl: string; coverUrl: string | null;
  validFrom: string; validTo: string; kind: "pdf" | "viewer";
};
export type CatalogResult = {
  retailer: CatalogRetailer; sourceUrl: string; checkedAt: string;
  status: "ready" | "no_current_leaflet" | "error";
  leaflets: CatalogLeaflet[]; errors: string[];
};
export function isCatalogRetailer(id: string): id is CatalogRetailer {
  return (CATALOG_RETAILERS as readonly string[]).includes(id);
}
export function todayPrague(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function normalized(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function decode(value: string): string {
  let result = value.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\\u002F/gi, "/").replace(/\\u0026/gi, "&").replace(/\\\//g, "/");
  for (let i = 0; i < 2; i++) { try { const next = decodeURIComponent(result); if (next === result) break; result = next; } catch { break; } }
  return result;
}
function day(value: unknown): string | null {
  const raw = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(raw + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : null;
}
function dmy(d: string, m: string, y: string): string | null { return day(`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`); }
function cs(raw: string | null): string { return raw ? raw.split("-").reverse().join(".") : ""; }
function czechDate(raw: unknown): string | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text(raw));
  return match ? dmy(match[1], match[2], match[3]) : null;
}
export function catalogValidity(label: string, yearHint?: string): { validFrom: string; validTo: string } | null {
  const value = decode(label);
  const match = /(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(?:(20\d{2})\s*)?(?:[-–—]|do)\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(20\d{2})?/.exec(value);
  if (!match) return null;
  const endYear = match[6] ?? match[3] ?? yearHint;
  if (!endYear) return null;
  const startYear = match[3] ?? String(Number(endYear) - (Number(match[2]) > Number(match[5]) ? 1 : 0));
  const validFrom = dmy(match[1],match[2],startYear), validTo = dmy(match[4],match[5],endYear);
  return validFrom && validTo && validFrom <= validTo ? { validFrom, validTo } : null;
}
function active(from: string | null, to: string | null, today: string): boolean { return !!from && !!to && from <= today && today <= to && from <= to; }
export function allowedCatalogDocument(retailer: CatalogRetailer, raw: string, kind: "pdf" | "viewer" = "pdf"): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
    if (kind === "viewer") return retailer === "penny" && u.hostname === "files.rewe.co.at" && /^\/PennyIntLeaflet\/CZ\/[\w-]+\/?$/.test(u.pathname);
    if (!PDF_HOSTS[retailer].includes(u.hostname)) return false;
    if (/\.pdf$/i.test(u.pathname)) return true;
    if (retailer === "globus") return u.pathname === "/OnlineAsset/3/asset" && /^[\da-f-]{36}$/i.test(u.searchParams.get("assetID") ?? "");
    return retailer === "rossmann" && /^\/obsah\/[^/]*--pdf-[^/]+\/akcni-letak-[\w-]+$/.test(u.pathname);
  } catch { return false; }
}
function makeLeaflet(retailer: CatalogRetailer, title: string, url: string, validFrom: string | null, validTo: string | null, today: string, cover: string | null = null, kind: "pdf" | "viewer" = "pdf"): CatalogLeaflet | null {
  if (!active(validFrom, validTo, today) || !allowedCatalogDocument(retailer,url,kind)) return null;
  const source = new URL(url); source.hash = "";
  // Content-disposition changes must not create another document for the same PDF.
  source.searchParams.delete("response-content-disposition");
  const key = createHash("sha256").update(source.toString()).digest("hex").slice(0,24);
  const name = title.replace(/[\\/:*?"<>|]+/g," ").replace(/\s+/g," ").trim();
  const extension = kind === "pdf" ? "pdf" : "html";
  return { retailerId: retailer, internalLeafletKey: `catalog:${retailer}:${key}`, storagePath: `${retailer}/catalog-${key}.${extension}`, filename: `${name || retailer + " akční leták"}.${extension}`, sourceUrl: source.toString(), coverUrl: cover, validFrom: validFrom!, validTo: validTo!, kind };
}
function structuredRows(html: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  function walk(node: unknown, depth = 0) {
    if (!node || typeof node !== "object" || depth > 30) return;
    if (Array.isArray(node)) { node.forEach(v => walk(v,depth+1)); return; }
    const row = node as Record<string, unknown>;
    if (row.__typename === "Leaflet") rows.push(row);
    Object.values(row).forEach(v => walk(v,depth+1));
  }
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(match[1])); } catch { /* Non-JSON scripts are not executed. */ }
  }
  return rows;
}
export function parseStructuredCatalog(retailer: "albert" | "tesco" | "globus", html: string, today: string): CatalogLeaflet[] {
  const out: CatalogLeaflet[] = [];
  const add = (item: CatalogLeaflet | null) => { if (item && !out.some(x => x.internalLeafletKey === item.internalLeafletKey)) out.push(item); };
  if (retailer === "globus") {
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      let nodes: unknown; try { nodes = JSON.parse(match[1]); } catch { continue; }
      if (!Array.isArray(nodes)) continue;
      const values = nodes;
      for (const raw of values) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const row = raw as Record<string,unknown>;
        const read = (key: string) => typeof row[key] === "number" ? values[row[key] as number] : row[key];
        if (read("offerType") !== "MainFlyer") continue;
        const from = day(read("validFrom")), to = day(read("validTo"));
        add(makeLeaflet(retailer,`Globus akční leták ${cs(from)}–${cs(to)}`,text(read("pdfAsset")),from,to,today));
      }
    }
    // Keep the newest main edition; older regional/extended editions must not flood the catalog.
    out.sort((a,b) => b.validFrom.localeCompare(a.validFrom));
    return out.filter(x => x.validFrom === out[0]?.validFrom).slice(0,4);
  }
  for (const row of structuredRows(html)) {
    if (retailer === "albert") {
      if (row.isDefault !== true || !/akcni[_ -]letak/i.test(normalized(text(row.title))) || !["HYPERMARKET","SUPERMARKET"].includes(text(row.locationType))) continue;
      const from = czechDate(row.validityStartDateFormatted), to = czechDate(row.validityEndDateFormatted);
      add(makeLeaflet(retailer,`Albert ${row.locationType === "HYPERMARKET" ? "hypermarket" : "supermarket"} akční leták ${cs(from)}–${cs(to)}`,text(row.downloadUrl),from,to,today,text(row.imageUrl)||null));
    } else {
      if (row.country !== "cz" || !["HM","SM"].includes(text(row.type))) continue;
      const from = day(row.validFrom), to = day(row.validTo);
      const pages = Array.isArray(row.pages) ? row.pages as Record<string,unknown>[] : [];
      const cover = pages.map(x => text(x.pagePNG)).find(u => /\.1\.(?:jpeg|jpg|png)(?:[?#]|$)/i.test(u)) ?? null;
      add(makeLeaflet(retailer,`Tesco ${row.type === "HM" ? "hypermarket" : "supermarket"} akční leták ${cs(from)}–${cs(to)}`,text(row.leafletUrl),from,to,today,cover));
    }
  }
  return out.slice(0,4);
}
export function parseSchwarzCatalog(retailer: "lidl" | "kaufland", payload: unknown, today: string): CatalogLeaflet[] {
  const out: CatalogLeaflet[] = [];
  function walk(node: unknown) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    const row = node as Record<string,unknown>;
    if (!row.pdfUrl && !row.hiResPdfUrl) { Object.values(row).forEach(walk); return; }
    if (row.isActive === false) return;
    const label = `${text(row.name)} ${text(row.title)}`;
    if (retailer === "lidl" && !/akcni letak/.test(normalized(label))) return;
    if (retailer === "kaufland" && /wrapper/i.test(text(row.flyerUrlAbsolute))) return;
    const range = catalogValidity(label);
    const from = range?.validFrom ?? day(row.offerStartDate), to = range?.validTo ?? day(row.offerEndDate);
    const title = retailer === "kaufland" ? `Kaufland ${/hyper/i.test(text(row.flyerUrlAbsolute)) ? "hypermarket" : "akční leták"} ${text(row.title)}` : label;
    const leaflet = makeLeaflet(retailer,title,text(row.pdfUrl)||text(row.hiResPdfUrl),from,to,today,text(row.publicThumbnail)||text(row.thumbnailUrl)||null);
    if (leaflet && !out.some(x => x.internalLeafletKey === leaflet.internalLeafletKey)) out.push(leaflet);
  }
  walk(payload); return out.slice(0,4);
}
export async function readCatalogSource(url: string, fetchImpl: typeof fetch = fetch, limit = MAX_HTML_BYTES): Promise<Response> {
  let target = new URL(url);
  for (let redirects = 0; redirects < 4; redirects++) {
    if (target.protocol !== "https:" || !SOURCE_HOSTS.has(target.hostname) || target.username || target.password || target.port) throw new Error("untrusted_source");
    const response = await fetchImpl(target.toString(), { redirect: "manual", signal: AbortSignal.timeout(25000), headers: { "user-agent": "SetrikLeafletCatalog/2.0", accept: "text/html,application/json,application/pdf" } });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location) throw new Error("redirect_without_location"); target = new URL(location,target); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`source_http_${response.status}`); }
    if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("source_too_large"); }
    return response;
  }
  throw new Error("too_many_redirects");
}
export async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) throw new Error("empty_source");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error("source_too_large"); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; } return bytes;
}
async function readText(url: string, fetchImpl: typeof fetch): Promise<string> { return new TextDecoder().decode(await boundedBytes(await readCatalogSource(url,fetchImpl),MAX_HTML_BYTES)); }
export async function collectPublicCatalog(retailer: CatalogRetailer, options: { fetchImpl?: typeof fetch; today?: string } = {}): Promise<CatalogResult> {
  const fetchImpl = options.fetchImpl ?? fetch, today = options.today ?? todayPrague();
  const result: CatalogResult = { retailer, sourceUrl: CATALOG_SOURCE_URLS[retailer], checkedAt: new Date().toISOString(), status: "no_current_leaflet", leaflets: [], errors: [] };
  try {
    const html = await readText(result.sourceUrl,fetchImpl);
    if (retailer === "lidl" || retailer === "kaufland") result.leaflets = parseSchwarzCatalog(retailer,JSON.parse(html),today);
    else if (retailer === "albert" || retailer === "tesco" || retailer === "globus") {
      const recognized = retailer === "globus" ? html.includes("pdfAsset") : structuredRows(html).length > 0;
      if (!recognized) throw new Error("catalog_metadata_not_found");
      result.leaflets = parseStructuredCatalog(retailer,html,today);
    }
    else {
      const assets = discoverLeafletAssets(html,result.sourceUrl,retailer).filter(asset => {
        const url = new URL(asset.url);
        if (retailer === "billa") return asset.kind === "pdf" && url.hostname === "view.publitas.com";
        if (retailer === "penny") return allowedCatalogDocument(retailer,asset.url,"viewer");
        if (retailer === "rossmann") return allowedCatalogDocument(retailer,asset.url);
        return url.hostname === "letak.tetadrogerie.cz" && /\/teta-letak-[\w-]+\//.test(url.pathname);
      }).slice(0,2);
      if (!assets.length) throw new Error("leaflet_candidates_not_found");
      for (const asset of assets) {
        try {
          const disposition = new URL(asset.url).searchParams.get("response-content-disposition") ?? "";
          const yearHint = /(?:^|\/)(?:\d{2})_(?:\d{2})_(20\d{2})_/.exec(new URL(asset.url).pathname)?.[1];
          const validity = catalogValidity(disposition + " " + asset.label,yearHint);
          if (!validity) { result.errors.push("offer_validity_not_found"); continue; }
          if (!active(validity.validFrom,validity.validTo,today)) continue;
          let sourceUrl = asset.url;
          if (retailer === "teta") {
            const viewer = await readText(asset.url,fetchImpl);
            const pdf = /https:\/\/liveecpaperdmp\.blob\.core\.windows\.net\/[^"<>\s]+\.pdf/i.exec(viewer)?.[0];
            if (!pdf) throw new Error("pdf_not_found"); sourceUrl = pdf;
          }
          const kind = retailer === "penny" ? "viewer" : "pdf";
          const cover = retailer === "penny" ? new URL("files/assets/cover300.jpg",asset.url).toString() : null;
          const leaflet = makeLeaflet(retailer,`${retailer.toUpperCase()} akční leták ${cs(validity.validFrom)}–${cs(validity.validTo)}`,sourceUrl,validity.validFrom,validity.validTo,today,cover,kind);
          if (leaflet) result.leaflets.push(leaflet);
        } catch(error) { result.errors.push(error instanceof Error ? error.message : "source_failed"); }
      }
    }
    result.status = result.leaflets.length ? "ready" : result.errors.length ? "error" : "no_current_leaflet";
  } catch (error) { result.status = "error"; result.errors.push(error instanceof Error ? error.message : "source_failed"); }
  return result;
}
