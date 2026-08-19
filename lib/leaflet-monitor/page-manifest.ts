import type { RetailerId } from "@/lib/leaflet-monitor/learning";

const USER_AGENT = "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";

export type LeafletPageSource = {
  page_no: number;
  text: string;
  image_url: string | null;
  source_url: string;
  source_kind: "schwarz_api" | "penny_html";
  external_id: string | null;
  alt_text: string | null;
};

export type LeafletPageManifest = {
  retailer: RetailerId;
  viewer_url: string;
  identifier: string;
  page_count: number;
  pdf_urls: string[];
  pages: LeafletPageSource[];
};

async function fetchText(url: string, accept = "text/html,application/json;q=0.9,*/*;q=0.8") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: accept,
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
      },
      signal: controller.signal,
    });
    return { response, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(input: string) {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripHtml(html: string) {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function collectPdfUrls(value: unknown, out = new Set<string>()) {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && /\.pdf(?:$|[?#])/i.test(value)) out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectPdfUrls(child, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) collectPdfUrls(child, out);
  }
  return out;
}

function findPages(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value) && value.length > 0 && value.every((item) => item && typeof item === "object")) {
    const sample = value.slice(0, 3) as Record<string, unknown>[];
    if (sample.some((item) => "number" in item && ("keyWords" in item || "image" in item || "links" in item))) {
      return value as Record<string, unknown>[];
    }
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/pages/i.test(key) && Array.isArray(child) && child.length) {
        const candidate = findPages(child);
        if (candidate) return candidate;
      }
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      const candidate = findPages(child);
      if (candidate) return candidate;
    }
  }
  return null;
}

function schwarzIds(retailer: RetailerId, viewerUrl: string) {
  const url = new URL(viewerUrl);
  if (retailer === "kaufland") {
    const match = url.pathname.match(/\/([^/]+)\/ar\/([^/]+)/i);
    return { identifier: match?.[1] ?? null, region: match?.[2] ?? null };
  }
  const match = url.pathname.match(/\/letak\/([^/]+)\/view\/flyer/i);
  return { identifier: match?.[1] ?? null, region: null };
}

async function resolveSchwarzManifest(retailer: RetailerId, viewerUrl: string): Promise<LeafletPageManifest> {
  const { identifier, region } = schwarzIds(retailer, viewerUrl);
  if (!identifier) throw new Error(`Nelze určit Schwarz flyer_identifier pro ${retailer}.`);

  const api = new URL("/v4/flyer", "https://endpoints.leaflets.schwarz");
  api.searchParams.set("flyer_identifier", identifier);
  if (region) {
    api.searchParams.set("region_id", region);
    api.searchParams.set("region_code", region);
  }

  const fetched = await fetchText(api.toString(), "application/json,text/plain,*/*");
  if (!fetched.response.ok) throw new Error(`${retailer} Schwarz API HTTP ${fetched.response.status}`);
  let json: unknown;
  try {
    json = JSON.parse(fetched.text);
  } catch {
    throw new Error(`${retailer} Schwarz API nevrátil JSON.`);
  }

  const rawPages = findPages(json);
  if (!rawPages?.length) throw new Error(`${retailer} Schwarz API neobsahuje stránky.`);

  const pages = rawPages
    .map((page) => {
      const pageNo = Number(page.number ?? page.pageNumber);
      const text = String(page.keyWords ?? page.keywords ?? page.altText ?? "").replace(/\s+/g, " ").trim();
      const image = typeof page.image === "string" ? page.image : typeof page.imageUrl === "string" ? page.imageUrl : null;
      return {
        page_no: pageNo,
        text,
        image_url: image,
        source_url: api.toString(),
        source_kind: "schwarz_api" as const,
        external_id: typeof page.id === "string" ? page.id : null,
        alt_text: typeof page.altText === "string" ? page.altText.trim() : null,
      };
    })
    .filter((page) => Number.isInteger(page.page_no) && page.page_no > 0)
    .sort((a, b) => a.page_no - b.page_no);

  return {
    retailer,
    viewer_url: viewerUrl,
    identifier,
    page_count: pages.length,
    pdf_urls: [...collectPdfUrls(json)],
    pages,
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function pennyPagePayload(text: string, identifier: string, pageNo: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const first = normalized.indexOf(identifier);
  const second = first >= 0 ? normalized.indexOf(identifier, first + identifier.length) : -1;
  if (second < 0) return normalized;
  const tail = normalized.slice(second + identifier.length).trim();
  return tail.replace(new RegExp(`^${pageNo}\\s+`), "").trim();
}

function allIndexes(haystack: string, needle: string) {
  const out: number[] = [];
  let from = 0;
  while (needle && from < haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    out.push(at);
    from = at + Math.max(1, needle.length);
  }
  return out;
}

function isolatePennyFirstPage(rootText: string, page2Text: string, identifier: string) {
  const root = rootText.replace(/\s+/g, " ").trim();
  const page2Payload = pennyPagePayload(page2Text, identifier, 2);
  let cutAt = -1;

  for (const size of [120, 90, 70, 50, 35]) {
    if (page2Payload.length < size) continue;
    const anchor = page2Payload.slice(0, size);
    const hits = allIndexes(root, anchor);
    if (!hits.length) continue;
    const usable = hits.filter((at) => at > 500);
    if (usable.length) {
      cutAt = usable[0];
      break;
    }
  }

  if (cutAt < 0) {
    throw new Error("Penny strana 1: nepodařilo se najít bezpečnou hranici začátku strany 2.");
  }

  const isolated = root.slice(0, cutAt).trim();
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const navPrefix = new RegExp(`^${escaped}\\s+(?:\\d+\\s+)+${escaped}\\s*`, "i");
  return isolated.replace(navPrefix, "").trim();
}

async function resolvePennyManifest(viewerUrl: string): Promise<LeafletPageManifest> {
  const rootFetch = await fetchText(viewerUrl);
  if (!rootFetch.response.ok) throw new Error(`Penny viewer HTTP ${rootFetch.response.status}`);
  const root = (rootFetch.response.url || viewerUrl).replace(/\/?$/, "/");
  const identifier = new URL(root).pathname.split("/").filter(Boolean).pop() || "penny-viewer";
  const pageNumbers = [...rootFetch.text.matchAll(/href=["'](?:\.\/)?(\d+)\/?["']/gi)]
    .map((match) => Number(match[1]))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 500);
  const pageCount = pageNumbers.length ? Math.max(...pageNumbers) : 1;
  const numbers = Array.from({ length: pageCount }, (_, i) => i + 1);

  const isolatedPages = await mapWithConcurrency(numbers.filter((n) => n >= 2), 6, async (pageNo) => {
    const url = new URL(`${pageNo}/`, root).toString();
    const fetched = await fetchText(url);
    if (!fetched.response.ok) throw new Error(`Penny strana ${pageNo} HTTP ${fetched.response.status}`);
    return {
      page_no: pageNo,
      text: stripHtml(fetched.text),
      image_url: null,
      source_url: fetched.response.url || url,
      source_kind: "penny_html" as const,
      external_id: null,
      alt_text: null,
    };
  });

  const rootText = stripHtml(rootFetch.text);
  const page2 = isolatedPages[0];
  if (!page2 || page2.page_no !== 2) throw new Error("Penny strana 2 chybí; nelze izolovat stranu 1.");
  const firstText = isolatePennyFirstPage(rootText, page2.text, identifier);
  const firstPage: LeafletPageSource = {
    page_no: 1,
    text: firstText,
    image_url: null,
    source_url: root,
    source_kind: "penny_html",
    external_id: null,
    alt_text: null,
  };

  const pages = [firstPage, ...isolatedPages];
  return { retailer: "penny", viewer_url: viewerUrl, identifier, page_count: pages.length, pdf_urls: [], pages };
}

export async function resolveViewerPageManifest(retailer: RetailerId, viewerUrl: string): Promise<LeafletPageManifest> {
  if (retailer === "penny") return resolvePennyManifest(viewerUrl);
  if (retailer === "lidl" || retailer === "kaufland") return resolveSchwarzManifest(retailer, viewerUrl);
  throw new Error(`Viewer manifest není podporovaný pro ${retailer}.`);
}

export function validatePageManifest(manifest: LeafletPageManifest) {
  const errors: string[] = [];
  if (manifest.page_count !== manifest.pages.length) errors.push("page_count nesouhlasí s pages.length");
  for (let i = 0; i < manifest.pages.length; i++) {
    const expected = i + 1;
    const page = manifest.pages[i];
    if (page.page_no !== expected) errors.push(`chybí nebo je mimo pořadí strana ${expected}`);
    if (!page.source_url) errors.push(`strana ${expected} nemá source_url`);
    if (!page.text.trim() && !page.image_url) errors.push(`strana ${expected} nemá text ani image_url`);
    if (/^redirect\b|not redirected automatically|follow the link/i.test(page.text.trim())) errors.push(`strana ${expected} obsahuje pouze redirect text`);
  }
  return { ok: errors.length === 0, errors };
}
