import { robotsAllowsPath } from "./billa.ts";
import { fetchAdapterText, requireAdapterUrl } from "./http.ts";
import { splitRetailerSitemap } from "./sitemap.ts";
import type { CatalogAdapter, CatalogProduct, CatalogRunStats } from "./types.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 80;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discoverProductUrls(adapter: CatalogAdapter, robots: string) {
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

  return [...productUrls].sort();
}

export type OfflineCatalogResult = {
  products: CatalogProduct[];
  stats: CatalogRunStats;
};

export async function collectCatalogOffline(
  adapter: CatalogAdapter,
  options?: { limit?: number }
): Promise<OfflineCatalogResult> {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(options?.limit ?? DEFAULT_LIMIT)));
  const concurrency = adapter.concurrency ?? 2;
  const startedAt = new Date().toISOString();
  const stats: CatalogRunStats = {
    retailer: adapter.retailer,
    discovered: 0,
    attempted: 0,
    saved: 0,
    failed: 0,
    unchangedRaw: 0,
    startedAt,
    finishedAt: startedAt,
    errors: [],
  };

  const robotsFetch = await fetchAdapterText(adapter, adapter.robotsUrl, 1_000_000);
  if (!robotsAllowsPath(robotsFetch.body, adapter.robotsMustAllowPath)) {
    throw new Error(adapter.robotsDeniedMessage);
  }

  const discovered = await discoverProductUrls(adapter, robotsFetch.body);
  stats.discovered = discovered.length;
  const queue = discovered.slice(0, limit);
  const products: CatalogProduct[] = [];

  for (let start = 0; start < queue.length; start += concurrency) {
    const batch = queue.slice(start, start + concurrency);
    const results = await Promise.all(
      batch.map(async (sourceUrl) => {
        try {
          const url = requireAdapterUrl(adapter, sourceUrl);
          if (!robotsAllowsPath(robotsFetch.body, url.pathname)) {
            throw new Error(`robots.txt does not allow product path ${url.pathname}`);
          }
          const fetched = await fetchAdapterText(adapter, sourceUrl);
          return { ok: true as const, product: adapter.parse(fetched.body, fetched.finalUrl) };
        } catch (error) {
          return {
            ok: false as const,
            url: sourceUrl,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );
    stats.attempted += results.length;
    for (const result of results) {
      if (result.ok) {
        products.push(result.product);
        stats.saved += 1;
      } else {
        stats.failed += 1;
        if (stats.errors.length < 12) stats.errors.push({ url: result.url, error: result.error });
      }
    }
    if (start + concurrency < queue.length) await delay(adapter.delayMs ?? 400);
  }

  stats.finishedAt = new Date().toISOString();
  return { products, stats };
}
