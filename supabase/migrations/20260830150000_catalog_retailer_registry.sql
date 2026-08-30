-- Explicit retailer parity registry. A listed retailer is not considered collected
-- until collector_status='verified' and enabled=true.

ALTER TABLE public.catalog_sources
  ALTER COLUMN sitemap_url DROP NOT NULL;

ALTER TABLE public.catalog_sources
  ADD COLUMN IF NOT EXISTS collector_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_notes text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'catalog_sources_collector_status_check'
      AND conrelid = 'public.catalog_sources'::regclass
  ) THEN
    ALTER TABLE public.catalog_sources
      ADD CONSTRAINT catalog_sources_collector_status_check
      CHECK (collector_status IN ('pending', 'verified', 'blocked', 'disabled'));
  END IF;
END $$;

INSERT INTO public.catalog_sources
  (retailer_id, display_name, base_url, sitemap_url, enabled, collector_status, capabilities, source_notes)
VALUES
  ('albert', 'Albert', 'https://www.albert.cz', NULL, false, 'pending', '{"catalog":false,"price_history":false}'::jsonb, 'Adapter must be verified against current public official sources.'),
  ('billa', 'BILLA', 'https://www.billa.cz', 'https://www.billa.cz/sitemap.xml', true, 'verified', '{"catalog":true,"price_history":true,"loyalty_price":true,"raw_archive":true}'::jsonb, 'Public robots.txt + sitemap + public product pages; collector implemented in this PR.'),
  ('dm', 'dm drogerie', 'https://www.dm.cz', NULL, false, 'pending', '{"catalog":false,"price_history":false}'::jsonb, 'Public online shop exists; dedicated adapter pending verification.'),
  ('globus', 'Globus', 'https://www.globus.cz', NULL, false, 'pending', '{"catalog":false,"price_history":false}'::jsonb, 'Dedicated adapter pending verification.'),
  ('kaufland', 'Kaufland', 'https://www.kaufland.cz', NULL, false, 'pending', '{"catalog":false,"price_history":false}'::jsonb, 'Keep grocery/leaflet data separate from marketplace assortment.'),
  ('kosik', 'Košík.cz', 'https://www.kosik.cz', NULL, false, 'pending', '{"catalog":false,"price_history":false}'::jsonb, 'Dedicated adapter pending verification.'),
  ('lidl', 'Lidl', 'https://www.lidl.cz', NULL, false, 'pending', '{"catalog":false,"price_history":false}'::jsonb, 'Leaflet pipeline exists separately; product catalog adapter pending.'),
  ('penny', 'PENNY', 'https://www.penny.cz', NULL, false, 'pending', '{"catalog":false,"price_history":false}'::jsonb, 'Public category/offer pages exist; catalog adapter pending.'),
  ('rohlik', 'Rohlík.cz', 'https://www.rohlik.cz', NULL, false, 'pending', '{"catalog":false,"price_history":false}'::jsonb, 'Dedicated adapter pending verification.'),
  ('rossmann', 'ROSSMANN', 'https://www.rossmann.cz', NULL, false, 'pending', '{"catalog":false,"price_history":false}'::jsonb, 'Public e-shop exists; dedicated adapter pending verification.'),
  ('tesco', 'Tesco', 'https://nakup.itesco.cz/groceries/cs-CZ', NULL, false, 'pending', '{"catalog":false,"price_history":false}'::jsonb, 'Dedicated adapter pending verification.'),
  ('teta', 'Teta drogerie', 'https://www.tetadrogerie.cz', NULL, false, 'pending', '{"catalog":false,"price_history":false}'::jsonb, 'Public e-shop exposes product prices and unit prices; dedicated adapter pending.')
ON CONFLICT (retailer_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  base_url = EXCLUDED.base_url,
  sitemap_url = COALESCE(EXCLUDED.sitemap_url, public.catalog_sources.sitemap_url),
  capabilities = CASE
    WHEN public.catalog_sources.collector_status = 'verified' THEN public.catalog_sources.capabilities
    ELSE EXCLUDED.capabilities
  END,
  source_notes = CASE
    WHEN public.catalog_sources.collector_status = 'verified' THEN public.catalog_sources.source_notes
    ELSE EXCLUDED.source_notes
  END,
  updated_at = now();

UPDATE public.catalog_sources
SET collector_status = 'verified',
    enabled = true,
    last_verified_at = COALESCE(last_verified_at, now()),
    capabilities = capabilities || '{"catalog":true,"price_history":true,"loyalty_price":true,"raw_archive":true}'::jsonb,
    updated_at = now()
WHERE retailer_id = 'billa';

CREATE INDEX IF NOT EXISTS catalog_sources_status_idx
  ON public.catalog_sources (collector_status, enabled);

COMMENT ON COLUMN public.catalog_sources.collector_status IS 'verified means a source adapter has been implemented and tested; pending entries must not be advertised as collected.';
COMMENT ON COLUMN public.catalog_sources.capabilities IS 'Machine-readable truth about catalog/history/loyalty/raw support per retailer.';
