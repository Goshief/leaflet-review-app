# Catalog collector operations

Production prerequisites:

- Apply catalog migrations in `supabase/migrations/` (`catalog_product_collector`, `catalog_comparison_core`, `catalog_retailer_registry`, `catalog_grocery_collectors`) to the Setrik Supabase project.
- Configure `CRON_SECRET` in the Vercel production environment. Catalog endpoints fail closed when it is missing.
- Verify the first production run with a small manual `limit` before relying on the daily schedule.

First-run checks:

```sql
select retailer_id, collector_status, enabled, sitemap_url
from public.catalog_sources
order by display_name;
select retailer_id, count(*) from public.catalog_discovered_urls group by 1;
select retailer_id, count(*) from public.retailer_products group by 1;
```

A healthy run has a `completed` row in `catalog_collector_runs`, product HTML snapshots in the private `catalog-raw` bucket, and matching rows in `retailer_products` / `retailer_offers_current`.
