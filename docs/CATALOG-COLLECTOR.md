# Product catalog collector

This pipeline is separate from the existing leaflet/PDF pipeline. It collects retailer-native public product data and preserves the source evidence used to derive each normalized row.

## BILLA v1

Source flow:

```text
https://www.billa.cz/robots.txt
        ↓
https://www.billa.cz/sitemap.xml (+ child sitemaps)
        ↓
public /produkt/... pages
        ↓
private Supabase Storage: catalog-raw
        ↓
retailer_products
        ↓
retailer_offers_current
        ↓
retailer_price_observations
```

The collector deliberately does not use Cenito as a source and does not bypass login, CAPTCHA, or access controls. It checks the current `robots.txt` before product crawling and only accepts HTTPS URLs on `billa.cz`.

## Where data is stored

- `catalog-raw`: private Storage bucket containing content-addressed robots/sitemap/product snapshots.
- `catalog_fetches`: database index tying source URL + SHA-256 to the stored RAW snapshot.
- `catalog_discovered_urls`: crawl queue populated from the public sitemap.
- `retailer_products`: normalized BILLA-native product identity and metadata.
- `retailer_offers_current`: latest price/availability observation.
- `retailer_price_observations`: one latest observation per Prague calendar day, preserving price history.
- `catalog_collector_runs`: operational run statistics and failures.

The catalog tables have RLS enabled and no `anon`/`authenticated` privileges. Writes are server-only through the existing Supabase admin client.

## Scheduling

Vercel calls:

```text
GET /api/cron/fetch-billa-products
```

once daily. The endpoint requires `Authorization: Bearer $CRON_SECRET` and fails closed if `CRON_SECRET` is missing.

A manual bounded run can use the same authenticated endpoint:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://<deployment>/api/cron/fetch-billa-products?limit=20"
```

`limit` is capped at 120 product pages per invocation; the scheduled default is 60. Products with the lowest crawl count are processed first, so new discoveries are automatically prioritized.

## Verification

Parser regression test:

```bash
node --experimental-strip-types scripts/test-catalog-billa-parser.mts
```

The test covers sitemap filtering, `robots.txt` allow/disallow handling, stable BILLA article IDs, standard price, BILLA klub price, quantity, unit price, image and origin extraction.
