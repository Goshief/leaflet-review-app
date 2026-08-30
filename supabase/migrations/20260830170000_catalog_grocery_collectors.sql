-- Mark grocery/drugstore collectors that have a verified public robots+sitemap+product adapter.
-- Remaining retailers stay pending/blocked until an official public catalog source exists.

UPDATE public.catalog_sources
SET collector_status = 'verified',
    enabled = true,
    sitemap_url = 'https://www.lidl.cz/static/sitemap.xml',
    last_verified_at = COALESCE(last_verified_at, now()),
    capabilities = capabilities || '{"catalog":true,"price_history":true,"loyalty_price":false,"raw_archive":true}'::jsonb,
    source_notes = 'Public robots.txt + gzip product sitemap + public /p product JSON-LD pages.',
    updated_at = now()
WHERE retailer_id = 'lidl';

UPDATE public.catalog_sources
SET collector_status = 'verified',
    enabled = true,
    sitemap_url = 'https://www.rossmann.cz/sitemap.xml',
    last_verified_at = COALESCE(last_verified_at, now()),
    capabilities = capabilities || '{"catalog":true,"price_history":true,"loyalty_price":false,"raw_archive":true,"gtin":true}'::jsonb,
    source_notes = 'Public robots.txt + sitemap-products + public product pages with EAN.',
    updated_at = now()
WHERE retailer_id = 'rossmann';

UPDATE public.catalog_sources
SET collector_status = 'verified',
    enabled = true,
    sitemap_url = 'https://www.rohlik.cz/sitemap.xml',
    last_verified_at = COALESCE(last_verified_at, now()),
    capabilities = capabilities || '{"catalog":true,"price_history":true,"loyalty_price":false,"raw_archive":true}'::jsonb,
    source_notes = 'Public robots.txt + sitemap_products.xml + public product JSON-LD pages.',
    updated_at = now()
WHERE retailer_id = 'rohlik';

UPDATE public.catalog_sources
SET collector_status = 'pending',
    enabled = false,
    source_notes = 'Product pages are a client-side SPA shell without server-rendered catalog fields. Dedicated public structured source required.',
    updated_at = now()
WHERE retailer_id = 'kosik';

UPDATE public.catalog_sources
SET collector_status = 'pending',
    enabled = false,
    source_notes = 'Public sitemap covers CMS/recipes, not a product catalog. /products currently 404.',
    updated_at = now()
WHERE retailer_id = 'penny';

UPDATE public.catalog_sources
SET collector_status = 'pending',
    enabled = false,
    source_notes = 'Public sitemap is editorial/blog. Product listing paths are disallowed by robots.txt.',
    updated_at = now()
WHERE retailer_id = 'globus';

UPDATE public.catalog_sources
SET collector_status = 'pending',
    enabled = false,
    source_notes = 'Official site sitemap is stores/recipes/content, not a product catalog.',
    updated_at = now()
WHERE retailer_id = 'albert';

UPDATE public.catalog_sources
SET collector_status = 'blocked',
    enabled = false,
    source_notes = 'nakup.itesco.cz currently returns Access Denied to the catalog bot. No bypass.',
    updated_at = now()
WHERE retailer_id = 'tesco';

UPDATE public.catalog_sources
SET collector_status = 'blocked',
    enabled = false,
    source_notes = 'www.kaufland.cz serves a Cloudflare challenge on robots.txt. Collector does not bypass bot walls.',
    updated_at = now()
WHERE retailer_id = 'kaufland';
