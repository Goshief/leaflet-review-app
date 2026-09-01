# Product catalog collector

This pipeline is separate from the existing leaflet/PDF pipeline. It collects retailer-native public product data and preserves the source evidence used to derive each normalized row.

The collector does not use Cenito as a source and does not bypass login, CAPTCHA, Cloudflare challenges, or access controls. Every adapter checks the live `robots.txt` before crawling and only accepts HTTPS URLs on that retailer's official host.

## Verified adapters

| Retailer | Source | Cron |
|---|---|---|
| BILLA | `robots.txt` + sitemap + `/produkt` HTML | `/api/cron/fetch-billa-products` |
| Teta | `robots.txt` + sitemap index + `/eshop/katalog` HTML | `/api/cron/fetch-teta-products` |
| dm | `robots.txt` + sitemap + `/p/d` HTML | `/api/cron/fetch-dm-products` |
| Lidl | `robots.txt` + gzip product sitemap + `/p/...` JSON-LD | `/api/cron/fetch-lidl-products` |
| Rossmann | `robots.txt` + `sitemap-products` + public product HTML/EAN | `/api/cron/fetch-rossmann-products` |
| Rohlík | `robots.txt` + `sitemap_products.xml` + JSON-LD | `/api/cron/fetch-rohlik-products` |

Source flow:

```text
official robots.txt
        ↓
official sitemap (+ child sitemaps)
        ↓
public product pages
        ↓
private Supabase Storage: catalog-raw
        ↓
retailer_products
        ↓
retailer_offers_current
        ↓
retailer_price_observations
        ↓
canonical_products / product_matches
```

## Not yet collected (honest registry)

These 12 comparison slots exist in `catalog_sources`, but a listed retailer is **not** advertised as collected until `collector_status='verified'` and `enabled=true`.

| Retailer | Status | Why |
|---|---|---|
| Košík.cz | pending | Product URLs are a client-side SPA shell without server-rendered catalog fields |
| PENNY | pending | Public sitemap is CMS/recipes; `/products` currently 404 |
| Globus | pending | Sitemap is editorial; product listing paths are disallowed by robots.txt |
| Albert | pending | Official sitemap is stores/recipes/content, not a product catalog |
| Tesco | blocked | `nakup.itesco.cz` returns Access Denied; no bypass |
| Kaufland | blocked | Cloudflare challenge on `robots.txt`; no bypass |

## Where data is stored

- `catalog-raw`: private Storage bucket containing content-addressed robots/sitemap/product snapshots.
- `catalog_fetches`: database index tying source URL + SHA-256 to the stored RAW snapshot.
- `catalog_discovered_urls`: crawl queue populated from the public sitemap.
- `retailer_products`: normalized retailer-native product identity and metadata.
- `retailer_offers_current`: latest price/availability observation.
- `retailer_price_observations`: one latest observation per Prague calendar day.
- `catalog_collector_runs`: operational run statistics and failures.

The catalog tables have RLS enabled and no `anon`/`authenticated` privileges. Writes are server-only through the existing Supabase admin client.

## Scheduling

Vercel calls each verified collector once daily. Every endpoint requires `Authorization: Bearer $CRON_SECRET` and fails closed if `CRON_SECRET` is missing.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://<deployment>/api/cron/fetch-lidl-products?limit=20"
```

`limit` is capped at 120 product pages per invocation; the scheduled default is 60. Products with the lowest crawl count are processed first.

## Verification

```bash
node --experimental-strip-types scripts/test-catalog-billa-parser.mts
node --experimental-strip-types scripts/test-catalog-teta-parser.mts
node --experimental-strip-types scripts/test-catalog-dm-parser.mts
node --experimental-strip-types scripts/test-catalog-lidl-parser.mts
node --experimental-strip-types scripts/test-catalog-rossmann-parser.mts
node --experimental-strip-types scripts/test-catalog-rohlik-parser.mts
node --experimental-strip-types scripts/test-catalog-comparison-core.mts
```
