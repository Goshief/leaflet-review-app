# Public action leaflet catalog

The browsable leaflet is published independently of OCR and product approval. One daily UTC cron per retailer downloads official documents, writes `leaflet_documents`, and stores `_catalog-checks/<retailer>.json`. The existing product-review/manual ingestion endpoints remain available. Automatic catalog publication has notifications disabled.

Supported sources: Albert supermarket/hypermarket, BILLA large action leaflet, Globus MainFlyer (newest edition), Lidl action leaflets, Kaufland weekly/hypermarket editions, Penny weekly official viewer, Rossmann action leaflet, Tesco supermarket/hypermarket, and Teta main leaflet. Catalogues, supplementary publications, expired offers and not-yet-valid offers are excluded. DM, Košík and Rohlík do not have verified full action-leaflet connectors in this change; their product collectors are unchanged.

`GET /api/leaflet-catalog?retailer=billa` returns validated public source metadata only. It never uploads or runs OCR. Šetřík can use it to recover a missing retailer and then read the shared database. Its public reader validates the response independently. Penny currently has an HTML viewer, not a downloadable PDF; an HTML snapshot is archived and the public page links to the official viewer.

`GET /api/cron/sync-leaflet-catalog/<retailer>` requires the bearer token configured by `CRON_SECRET`. Missing configuration returns 503; an incorrect token returns 401. Vercel supplies the token automatically to production cron invocations. No public `manual=1` override exists on this endpoint. Preview deployments do not run cron jobs.

## Rollout

1. Deploy this repository and configure `CRON_SECRET` for the deployment, plus the existing shared Supabase URL and server-only service key.
2. Verify the public metadata endpoint for each supported retailer. `ready`, `no_current_leaflet` and `error` are distinct. Teta's source on 7 October 2026 publishes an offer starting 8 October, so zero current leaflets is expected that day.
3. Deploy the corresponding Šetřík change (PR #136). No database migration is required: its legacy PDF RPC remains unchanged; the reader adds a bounded Penny HTML-metadata read.
4. Verify an authenticated scheduled/manual invocation on production, check `_catalog-checks`, the status panel, and public `/letaky` plus a PDF/official-viewer detail. Do not log the bearer token.

Storage quota/upload failures are recorded and cause a non-successful cron response. Metadata can still link to the official document using a `remote-catalog-` path. That path is retried on a subsequent scheduled run. Successful archived PDFs are not redownloaded every day, and updating metadata does not reset existing processing/review status.

## Checks

`npm run test:public-catalog` covers source formats captured on 7 October, active-date boundaries, catalogue exclusions, allowed origins and redirect boundaries, bounded reads, invalid PDF rejection, publication, and repeat runs. `npx tsc --noEmit --incremental false` validates application types. Source metadata fixtures contain no credentials or customer data.
