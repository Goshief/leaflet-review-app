# Catalog collector rollback

If the BILLA product collector causes operational issues after deployment:

1. Remove or disable `/api/cron/fetch-billa-products` in `vercel.json` and redeploy.
2. Keep `catalog-raw` and the catalog tables intact for evidence/history; stopping the cron is enough to stop writes.
3. The catalog pipeline is isolated from the existing leaflet/PDF tables, so disabling it does not require reverting leaflet data.
4. If schema removal is ever required, do it in a separate reviewed migration after exporting any required RAW evidence/history.
