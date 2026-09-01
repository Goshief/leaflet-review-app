import type { SupabaseClient } from "@supabase/supabase-js";
import { robotsAllowsPath } from "./billa";
import { fetchAdapterText, requireAdapterUrl } from "./http";
import { persistCatalogProduct } from "./persist";
import { splitRetailerSitemap } from "./sitemap";
import { saveRawSnapshot } from "./storage";
import type { CatalogAdapter, CatalogRetailerId, CatalogRunStats } from "./types";

export type { CatalogAdapter };

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 120;

type DiscoveredRow = {
  id: string;
  source_url: string;
  external_id: string | null;
  crawl_count: number | null;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertDiscoveredUrls(supabase: SupabaseClient, adapter: CatalogAdapter, urls: string[]) {
  const now = new Date().toISOString();
  for (let start = 0; start < urls.length; start += 500) {
    const rows = urls.slice(start, start + 500).map((sourceUrl) => ({
      retailer_id: adapter.retailer,
      source_url: sourceUrl,
      external_id: adapter.externalIdFromUrl(sourceUrl),
      last_discovered_at: now,
      updated_at: now,
    }));
    const { error } = await supabase.from("catalog_discovered_urls").upsert(rows, { onConflict: "retailer_id,source_url" });
    if (error) throw new Error(`${adapter.retailer} URL discovery persistence: ${error.message}`);
  }
}

async function discoverProductUrls(
  supabase: SupabaseClient,
  adapter: CatalogAdapter,
  robots: string
) {
  const productUrls = new Set<string>();
  const visited = new Set<string>();
  const maxSitemaps = adapter.maxSitemaps ?? 32;
  const queue: Array<{ url: string; depth: number }> = [{ url: adapter.sitemapUrl, depth: 0 }];

  while (queue.length && visited.size < maxSitemaps) {
    const next = queue.shift();
    if (!next || visited.has(next.url)) continue;
    const sitemapUrl = requireAdapterUrl(adapter, next.url);
    if (!robotsAllowsPath(robots, sitemapUrl.pathname)) {
      throw new Error(`robots.txt does not allow sitemap path ${sitemapUrl.pathname}`);
    }
    visited.add(next.url);

    const fetched = await fetchAdapterText(adapter, next.url, 20_000_000);
    await saveRawSnapshot(supabase, { retailer: adapter.retailer, kind: "sitemap", fetched });
    const split = splitRetailerSitemap(fetched.body, adapter);
    for (const productUrl of split.productUrls) productUrls.add(productUrl);

    if (next.depth >= 2) continue;
    const preferred = [...split.childSitemaps].sort((a, b) => {
      const prefer = adapter.preferSitemapName ?? /product|produkt/i;
      const ap = prefer.test(a) ? 0 : 1;
      const bp = prefer.test(b) ? 0 : 1;
      return ap - bp || a.localeCompare(b);
    });
    for (const child of preferred) {
      if (queue.length + visited.size >= maxSitemaps) break;
      if (!visited.has(child)) queue.push({ url: child, depth: next.depth + 1 });
    }
  }

  const urls = [...productUrls].sort();
  await upsertDiscoveredUrls(supabase, adapter, urls);
  return urls;
}

async function selectedProducts(supabase: SupabaseClient, retailer: CatalogRetailerId, limit: number): Promise<DiscoveredRow[]> {
  const { data, error } = await supabase
    .from("catalog_discovered_urls")
    .select("id,source_url,external_id,crawl_count")
    .eq("retailer_id", retailer)
    .order("crawl_count", { ascending: true })
    .order("last_crawled_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(`catalog crawl queue: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    source_url: String(row.source_url),
    external_id: row.external_id == null ? null : String(row.external_id),
    crawl_count: row.crawl_count == null ? 0 : Number(row.crawl_count),
  }));
}

async function markUrl(
  supabase: SupabaseClient,
  row: DiscoveredRow,
  patch: { status?: number | null; error?: string | null }
) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("catalog_discovered_urls")
    .update({
      last_crawled_at: now,
      crawl_count: Number(row.crawl_count || 0) + 1,
      last_http_status: patch.status ?? null,
      last_error: patch.error ?? null,
      updated_at: now,
    })
    .eq("id", row.id);
  if (error) throw new Error(`catalog crawl queue update: ${error.message}`);
}

async function processProduct(
  supabase: SupabaseClient,
  adapter: CatalogAdapter,
  robots: string,
  row: DiscoveredRow
) {
  let status: number | null = null;
  try {
    const url = requireAdapterUrl(adapter, row.source_url);
    if (!robotsAllowsPath(robots, url.pathname)) {
      throw new Error(`robots.txt does not allow product path ${url.pathname}`);
    }
    const fetched = await fetchAdapterText(adapter, row.source_url);
    status = fetched.status;
    const product = adapter.parse(fetched.body, fetched.finalUrl);
    const raw = await saveRawSnapshot(supabase, {
      retailer: adapter.retailer,
      kind: "product",
      externalId: product.externalId ?? row.external_id ?? adapter.externalIdFromUrl(row.source_url),
      fetched,
    });
    await persistCatalogProduct(supabase, { product, fetchId: raw.fetchId });
    await markUrl(supabase, row, { status, error: null });
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

async function createRun(supabase: SupabaseClient, retailer: CatalogRetailerId) {
  const { data, error } = await supabase
    .from("catalog_collector_runs")
    .insert({ retailer_id: retailer, status: "running" })
    .select("id,started_at")
    .single();
  if (error || !data?.id) throw new Error(`catalog collector run: ${error?.message || "missing id"}`);
  return { id: String(data.id), startedAt: String(data.started_at) };
}

async function finishRun(
  supabase: SupabaseClient,
  adapter: CatalogAdapter,
  runId: string,
  stats: CatalogRunStats,
  error?: string
) {
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
  if (runError) throw new Error(`${adapter.retailer} run finalization: ${runError.message}`);

  const sourcePatch: Record<string, unknown> = {
    last_discovered_count: stats.discovered,
    last_run_at: stats.finishedAt,
    last_error: error ?? null,
    last_stats: stats,
    updated_at: stats.finishedAt,
  };
  if (!error) sourcePatch.last_success_at = stats.finishedAt;
  const { error: sourceError } = await supabase.from("catalog_sources").update(sourcePatch).eq("retailer_id", adapter.retailer);
  if (sourceError) throw new Error(`${adapter.retailer} source finalization: ${sourceError.message}`);
}

export async function runCatalogCollector(
  supabase: SupabaseClient,
  adapter: CatalogAdapter,
  options?: { limit?: number }
): Promise<CatalogRunStats> {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(options?.limit ?? DEFAULT_LIMIT)));
  const concurrency = adapter.concurrency ?? 3;
  const run = await createRun(supabase, adapter.retailer);
  let stats: CatalogRunStats = {
    retailer: adapter.retailer,
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
    const robotsFetch = await fetchAdapterText(adapter, adapter.robotsUrl, 1_000_000);
    await saveRawSnapshot(supabase, { retailer: adapter.retailer, kind: "robots", fetched: robotsFetch });
    const robots = robotsFetch.body;
    if (!robotsAllowsPath(robots, adapter.robotsMustAllowPath)) {
      throw new Error(adapter.robotsDeniedMessage);
    }

    const discovered = await discoverProductUrls(supabase, adapter, robots);
    stats.discovered = discovered.length;
    const queue = await selectedProducts(supabase, adapter.retailer, limit);

    for (let start = 0; start < queue.length; start += concurrency) {
      const batch = queue.slice(start, start + concurrency);
      const results = await Promise.all(batch.map((row) => processProduct(supabase, adapter, robots, row)));
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
      if (start + concurrency < queue.length) await delay(adapter.delayMs ?? 300);
    }

    stats = { ...stats, finishedAt: new Date().toISOString() };
    await finishRun(supabase, adapter, run.id, stats);
    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stats = { ...stats, finishedAt: new Date().toISOString() };
    try {
      await finishRun(supabase, adapter, run.id, stats, message);
    } catch {
      // Preserve original error.
    }
    throw error;
  }
}
