# Catalog collector operations

Production prerequisites:

- Apply `supabase/migrations/20260830130000_catalog_product_collector.sql` to the Setrik Supabase project.
- Configure `CRON_SECRET` in the Vercel production environment. The endpoint fails closed when it is missing.
- Verify the first production run with a small manual `limit` before relying on the daily schedule.

First-run checks:

```sql
select * from public.catalog_sources where retailer_id = 'billa';
select count(*) from public.catalog_discovered_urls where retailer_id = 'billa';
select count(*) from public.retailer_products where retailer_id = 'billa';
select count(*) from public.retailer_offers_current where retailer_id = 'billa';
select count(*) from public.retailer_price_observations where retailer_id = 'billa';
```

A healthy run has a `completed` row in `catalog_collector_runs`, product HTML snapshots in the private `catalog-raw` bucket, and matching rows in `retailer_products` / `retailer_offers_current`.
