import type { SupabaseClient } from "@supabase/supabase-js";
import { robotsAllowsPath } from "./billa.ts";
import { persistCatalogProduct } from "./persist";
import { saveRawSnapshot } from "./storage";
import {
  TETA_ROBOTS_URL,
  TETA_SITEMAP_URL,
  parseTetaProductPage,
  splitTetaSitemap,
} from "./teta.ts";
import type { CatalogRunStats, FetchedText } from "./types.ts";

const USER_AGENT = "SetrikCatalogBot/1.0 (+https://leaflet-review-app.vercel.app)";
const RETAILER = "teta" as const;
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 120;
const CONCURRENCY = 3;
const MAX_SITEMAPS = 128;
let activeRobots = "";

type DiscoveredRow = {
  id: string;
  source_url: string;
  crawl_count: number | null;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireTetaUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !/^(?:www\.)?tetadrogerie\.cz$/i.test(url.hostname)) {
    throw new Error(`Catalog collector rejected non-Teta URL: ${url.hostname}`);
  }
  return url;
}

async function fetchText(urlValue: string, maxBytes = 5_000_000): Promise<FetchedText> {
  const url = requireTetaUrl(urlValue);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.5",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
      },
    });
    const finalUrl = requireTetaUrl(response.url || url.toString()).toString();
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxBytes) throw new Error(`Response too large: ${contentLength} bytes`);
    const body = await response.text();
    if (body.length > maxBytes) throw new Error(`Response too large after download: ${body.length} chars`);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${finalUrl}`);
    return {
      requestedUrl: url.toString(),
      finalUrl,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function upsertDiscoveredUrls(supabase: SupabaseClient, urls: string[]) {
  const now = new Date().toISOString();
  for (let start = 0; start < urls.length; start += 500) {
    const rows = urls.slice(start, start + 500).map((sourceUrl) => ({
      retailer_id: RETAILER,
      source_url: sourceUrl,
      external_id: null,
      last_discovered_at: now,
      updated_at: now,
    }));
    const { error } = await supabase
      .from("catalog_discovered_urls")
      .upsert(rows, { onConflict: "retailer_id,source_url" });
    if (error) throw new Error(`Teta URL discovery persistence: ${error.message}`);
  }
}

async function discoverTetaProductUrls(supabase: SupabaseClient, robots: string) {
  const productUrls = new Set<string>();
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: TETA_SITEMAP_URL, depth: 0 }];

  while (queue.length && visited.size < MAX_SITEMAPS) {
    const next = queue.shift();
    if (!next || visited.has(next.url)) continue;
    const sitemapUrl = requireTetaUrl(next.url);
    if (!robotsAllowsPath(robots, sitemapUrl.pathname)) {
      throw new Error(`Teta robots.txt does not allow sitemap path ${sitemapUrl.pathname}`);
    }
    visited.add(next.url);

    const fetched = await fetchText(next.url, 15_000_000);
    await saveRawSnapshot(supabase, { retailer: RETAILER, kind: "sitemap", fetched });
    const split = splitTetaSitemap(fetched.body);
    for (const productUrl of split.productUrls) productUrls.add(productUrl);

    if (next.depth >= 2) continue;
    const preferred = [...split.childSitemaps].sort((a, b) => {
      const ap = /product|produkt|eshop|katalog/i.test(a) ? 0 : 1;
      const bp = /product|produkt|eshop|katalog/i.test(b) ? 0 : 1;
      return ap - bp || a.localeCompare(b);
    });
    for (const child of preferred) {
      if (queue.length + visited.size >= MAX_SITEMAPS) break;
      if (!visited.has(child)) queue.push({ url: child, depth: next.depth + 1 });
    }
  }

  const urls = [...productUrls].sort();
  await upsertDiscoveredUrls(supabase, urls);
  return urls;
}

async function selectedProducts(supabase: SupabaseClient, limit: number): Promise<DiscoveredRow[]> {
  const { data, error } = await supabase
    .from("catalog_discovered_urls")
    .select("id,source_url,crawl_count")
    .eq("retailer_id", RETAILER)
    .order("crawl_count", { ascending: true })
    .order("last_crawled_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(`Teta crawl queue: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    source_url: String(row.source_url),
    crawl_count: row.crawl_count == null ? 0 : Number(row.crawl_count),
  }));
}

async function markUrl(
  supabase: SupabaseClient,
  row: DiscoveredRow,
  patch: { status?: number | null; error?: string | null; externalId?: string | null }
) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("catalog_discovered_urls")
    .update({
      external_id: patch.externalId ?? undefined,
      last_crawled_at: now,
      crawl_count: Number(row.crawl_count || 0) + 1,
      last_http_status: patch.status ?? null,
      last_error: patch.error ?? null,
      updated_at: now,
    })
    .eq("id", row.id);
  if (error) throw new Error(`Teta crawl queue update: ${error.message}`);
}

async function processProduct(supabase: SupabaseClient, row: DiscoveredRow) {
  let status: number | null = null;
  try {
    const url = requireTetaUrl(row.source_url);
    if (!robotsAllowsPath(activeRobots, url.pathname)) {
      throw new Error(`Teta robots.txt does not allow product path ${url.pathname}`);
    }
    const fetched = await fetchText(row.source_url);
    status = fetched.status;
    const product = parseTetaProductPage(fetched.body, fetched.finalUrl);
    const raw = await saveRawSnapshot(supabase, {
      retailer: RETAILER,
      kind: "product",
      externalId: product.externalId,
      fetched,
    });
    await persistCatalogProduct(supabase, { product, fetchId: raw.fetchId });
    await markUrl(supabase, row, { status, error: null, externalId: product.externalId });
    return { ok: true as const, unchangedRaw: raw.unchangedRaw };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await markUrl(supabase, row, { status, error: message.slice(0, 1500) });
    } catch {
      // Preserve the original collector error in the run summary.
    }
    return { ok: false as const, unchangedRaw: false, error: message };
  }
}

async function createRun(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("catalog_collector_runs")
    .insert({ retailer_id: RETAILER, status: "running" })
    .select("id,started_at")
    .single();
  if (error || !data?.id) throw new Error(`Teta collector run: ${error?.message || "missing id"}`);
  return { id: String(data.id), startedAt: String(data.started_at) };
}

async function finishRun(supabase: SupabaseClient, runId: string, stats: CatalogRunStats, error?: string) {
  const { error: runError } = await supabase
    .from("catalog_collector_runs")
    .update({
      finished_at: stats.finishedAt,
      status: error ? "failed" : "completed",
      discovered_count: stats.discovered,
      attempted_count: stats.attempted,
      saved_count: stats.saved,
      failed_count: stats.failed,
      stats,
      error: error ?? null,
    })
    .eq("id", runId);
  if (runError) throw new Error(`Teta run finalization: ${runError.message}`);

  const sourcePatch: Record<string, unknown> = {
    last_discovered_count: stats.discovered,
    last_run_at: stats.finishedAt,
    last_error: error ?? null,
    last_stats: stats,
    updated_at: stats.finishedAt,
  };
  if (!error) sourcePatch.last_success_at = stats.finishedAt;
  const { error: sourceError } = await supabase
    .from("catalog_sources")
    .update(sourcePatch)
    .eq("retailer_id", RETAILER);
  if (sourceError) throw new Error(`Teta source finalization: ${sourceError.message}`);
}

export async function runTetaCatalogCollector(
  supabase: SupabaseClient,
  options?: { limit?: number }
): Promise<CatalogRunStats> {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(options?.limit ?? DEFAULT_LIMIT)));
  const run = await createRun(supabase);
  let stats: CatalogRunStats = {
    retailer: RETAILER,
    discovered: 0,
    attempted: 0,
    saved: 0,
    failed: 0,
    unchangedRaw: 0,
    startedAt: run.startedAt,
    finishedAt: run.startedAt,
    errors: [],
  };

  try {
    const robotsFetch = await fetchText(TETA_ROBOTS_URL, 1_000_000);
    await saveRawSnapshot(supabase, { retailer: RETAILER, kind: "robots", fetched: robotsFetch });
    activeRobots = robotsFetch.body;
    if (!robotsAllowsPath(activeRobots, "/eshop/katalog/")) {
      throw new Error("Teta robots.txt currently disallows /eshop/katalog/ crawling");
    }

    const discovered = await discoverTetaProductUrls(supabase, activeRobots);
    stats.discovered = discovered.length;
    const queue = await selectedProducts(supabase, limit);

    for (let start = 0; start < queue.length; start += CONCURRENCY) {
      const batch = queue.slice(start, start + CONCURRENCY);
      const results = await Promise.all(batch.map((row) => processProduct(supabase, row)));
      stats.attempted += results.length;
      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
        if (result.ok) {
          stats.saved += 1;
          if (result.unchangedRaw) stats.unchangedRaw += 1;
        } else {
          stats.failed += 1;
          if (stats.errors.length < 12) {
            stats.errors.push({ url: batch[i]?.source_url ?? "unknown", error: result.error });
          }
        }
      }
      if (start + CONCURRENCY < queue.length) await delay(300);
    }

    stats = { ...stats, finishedAt: new Date().toISOString() };
    await finishRun(supabase, run.id, stats);
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stats = { ...stats, finishedAt: new Date().toISOString() };
    try {
      await finishRun(supabase, run.id, stats, message);
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
}
