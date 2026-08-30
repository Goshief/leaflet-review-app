export type SitemapSplitConfig = {
  hostPattern: RegExp;
  productPath: RegExp;
};

export function extractSitemapLocations(xml: string) {
  const locations: string[] = [];
  for (const match of xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)) {
    const value = (match[1] || "")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .trim();
    if (value) locations.push(value);
  }
  return locations;
}

export function splitRetailerSitemap(xml: string, adapter: SitemapSplitConfig) {
  const productUrls: string[] = [];
  const childSitemaps: string[] = [];
  for (const raw of extractSitemapLocations(xml)) {
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || !adapter.hostPattern.test(url.hostname)) continue;
      if (adapter.productPath.test(url.pathname)) productUrls.push(url.toString());
      else if (/\.xml(?:\.gz)?(?:$|\?)/i.test(url.pathname + url.search)) childSitemaps.push(url.toString());
    } catch {
      // Ignore malformed sitemap rows.
    }
  }
  return {
    productUrls: [...new Set(productUrls)],
    childSitemaps: [...new Set(childSitemaps)],
  };
}
