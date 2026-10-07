# Public action leaflet catalog

The browsable leaflet is published independently of OCR and product approval. One daily UTC cron per retailer downloads official documents, writes `leaflet_documents`, and stores `_catalog-checks/<retailer>.json`. The existing product-review/manual ingestion endpoints remain available. Automatic catalog publication has notifications disabled.

Supported sources: Albert supermarket/hypermarket, BILLA large action leaflet, Globus MainFlyer (newest edition), Lidl action leaflets, Kaufland weekly/hypermarket editions, Penny weekly official viewer, Rossmann action leaflet, Tesco supermarket/hypermarket, and Teta main leaflet. Catalogues, supplementary publications, expired offers and not-yet-valid offers are excluded. DM, Košík and Rohlík do not have verified full action-leaflet connectors in this change; their product collectors are unchanged.

`GET /api/leaflet-catalog?retailer=billa` returns validated public source metadata only. It never uploads or runs OCR. Šetřík can use it to recover a missing retailer and then read the shared database. Its public reader validates the response independently. Penny currently has an HTML viewer, not a downloadable PDF; its snapshot is archived in a JSON envelope (the `.html` metadata path identifies a viewer) and the public page links to the official viewer. This works with the existing bucket's JSON/PDF MIME restrictions without serving executable archived HTML.

`GET /api/cron/sync-leaflet-catalog/<retailer>` requires the bearer token configured by `CRON_SECRET`. Missing configuration returns 503; an incorrect token returns 401. Vercel supplies the token automatically to production cron invocations. No public `manual=1` override exists on this endpoint. Preview deployments do not run cron jobs.

## Rollout

1. Deploy this repository and configure `CRON_SECRET` for the deployment, plus the existing shared Supabase URL and server-only service key.
2. Verify the public metadata endpoint for each supported retailer. `ready`, `no_current_leaflet` and `error` are distinct. Teta's source on 7 October 2026 publishes an offer starting 8 October, so zero current leaflets is expected that day.
3. Deploy the corresponding Šetřík change (PR #136). No database migration is required: its legacy PDF RPC remains unchanged; the reader adds a bounded Penny HTML-metadata read.
4. Verify an authenticated scheduled/manual invocation on production, check `_catalog-checks`, the status panel, and public `/letaky` plus a PDF/official-viewer detail. Do not log the bearer token.

Storage quota/upload failures are recorded and cause a non-successful cron response. Metadata can still link to the official document using a `remote-catalog-` path. That path is retried on a subsequent scheduled run. Successful archived PDFs are not redownloaded every day, and updating metadata does not reset existing processing/review status.

## Checks

`npm run test:public-catalog` covers source formats captured on 7 October, active-date boundaries, catalogue exclusions, allowed origins and redirect boundaries, bounded reads, invalid PDF rejection, publication, and repeat runs. `npx tsc --noEmit --incremental false` validates application types. Source metadata fixtures contain no credentials or customer data.

Preview verification on 7 October returned HTTP 200/current metadata for Albert, Billa, Globus, Kaufland, Lidl, Penny and Rossmann, and HTTP 200/no-current for Teta. Tesco returned source HTTP 403 from Vercel despite working from the test workspace; that connector requires further verification before claiming reliable scheduled coverage. Globus PDF archival is also unverified: the workspace request returned 502. Preview metadata checks do not write to the shared database or prove physical storage publication. CRON_SECRET has been configured for preview and production; production deployment and an authenticated publication check remain pending.
