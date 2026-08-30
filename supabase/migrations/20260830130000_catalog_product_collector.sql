-- Product catalog collector: raw retailer sources -> normalized products -> current offers -> daily price history.
-- All writes are server-only through the Supabase service role. Public/client access is intentionally denied.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('catalog-raw', 'catalog-raw', false, 20971520, NULL)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.catalog_sources (
  retailer_id text PRIMARY KEY,
  display_name text NOT NULL,
  base_url text NOT NULL,
  sitemap_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_discovered_count integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_discovered_urls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id text NOT NULL REFERENCES public.catalog_sources (retailer_id) ON DELETE CASCADE,
  source_url text NOT NULL,
  external_id text,
  first_discovered_at timestamptz NOT NULL DEFAULT now(),
  last_discovered_at timestamptz NOT NULL DEFAULT now(),
  last_crawled_at timestamptz,
  crawl_count integer NOT NULL DEFAULT 0,
  last_http_status integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (retailer_id, source_url)
);

CREATE TABLE IF NOT EXISTS public.catalog_collector_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id text NOT NULL REFERENCES public.catalog_sources (retailer_id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  discovered_count integer NOT NULL DEFAULT 0,
  attempted_count integer NOT NULL DEFAULT 0,
  saved_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);

CREATE TABLE IF NOT EXISTS public.catalog_fetches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id text NOT NULL REFERENCES public.catalog_sources (retailer_id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('robots', 'sitemap', 'product')),
  source_url text NOT NULL,
  external_id text,
  http_status integer NOT NULL,
  content_type text,
  content_sha256 text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'catalog-raw',
  storage_path text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (retailer_id, source_url, content_sha256)
);

CREATE TABLE IF NOT EXISTS public.retailer_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id text NOT NULL REFERENCES public.catalog_sources (retailer_id) ON DELETE CASCADE,
  external_id text NOT NULL,
  source_url text NOT NULL,
  name text NOT NULL,
  brand text,
  sku text,
  gtin text,
  quantity_value numeric(14, 4),
  quantity_unit text,
  image_url text,
  category text,
  country_of_origin text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_fetch_id uuid REFERENCES public.catalog_fetches (id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (retailer_id, external_id)
);

CREATE TABLE IF NOT EXISTS public.retailer_offers_current (
  retailer_product_id uuid PRIMARY KEY REFERENCES public.retailer_products (id) ON DELETE CASCADE,
  retailer_id text NOT NULL REFERENCES public.catalog_sources (retailer_id) ON DELETE CASCADE,
  price numeric(14, 2),
  regular_price numeric(14, 2),
  loyalty_price numeric(14, 2),
  unit_price numeric(14, 4),
  unit_basis text,
  currency text NOT NULL DEFAULT 'CZK',
  available boolean NOT NULL DEFAULT true,
  source_url text NOT NULL,
  offer_fingerprint text NOT NULL,
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.retailer_price_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_product_id uuid NOT NULL REFERENCES public.retailer_products (id) ON DELETE CASCADE,
  retailer_id text NOT NULL REFERENCES public.catalog_sources (retailer_id) ON DELETE CASCADE,
  observed_on date NOT NULL,
  observed_at timestamptz NOT NULL,
  price numeric(14, 2),
  regular_price numeric(14, 2),
  loyalty_price numeric(14, 2),
  unit_price numeric(14, 4),
  unit_basis text,
  currency text NOT NULL DEFAULT 'CZK',
  available boolean NOT NULL DEFAULT true,
  source_url text NOT NULL,
  offer_fingerprint text NOT NULL,
  UNIQUE (retailer_product_id, observed_on)
);

CREATE INDEX IF NOT EXISTS catalog_discovered_urls_queue_idx
  ON public.catalog_discovered_urls (retailer_id, crawl_count, last_crawled_at);
CREATE INDEX IF NOT EXISTS catalog_fetches_retailer_time_idx
  ON public.catalog_fetches (retailer_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS catalog_collector_runs_retailer_time_idx
  ON public.catalog_collector_runs (retailer_id, started_at DESC);
CREATE INDEX IF NOT EXISTS retailer_products_retailer_name_idx
  ON public.retailer_products (retailer_id, name);
CREATE INDEX IF NOT EXISTS retailer_products_gtin_idx
  ON public.retailer_products (gtin) WHERE gtin IS NOT NULL;
CREATE INDEX IF NOT EXISTS retailer_price_observations_product_date_idx
  ON public.retailer_price_observations (retailer_product_id, observed_on DESC);
CREATE INDEX IF NOT EXISTS retailer_price_observations_retailer_date_idx
  ON public.retailer_price_observations (retailer_id, observed_on DESC);

CREATE OR REPLACE FUNCTION public.catalog_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS catalog_sources_touch_updated_at ON public.catalog_sources;
CREATE TRIGGER catalog_sources_touch_updated_at
  BEFORE UPDATE ON public.catalog_sources
  FOR EACH ROW EXECUTE FUNCTION public.catalog_touch_updated_at();

DROP TRIGGER IF EXISTS catalog_discovered_urls_touch_updated_at ON public.catalog_discovered_urls;
CREATE TRIGGER catalog_discovered_urls_touch_updated_at
  BEFORE UPDATE ON public.catalog_discovered_urls
  FOR EACH ROW EXECUTE FUNCTION public.catalog_touch_updated_at();

DROP TRIGGER IF EXISTS retailer_products_touch_updated_at ON public.retailer_products;
CREATE TRIGGER retailer_products_touch_updated_at
  BEFORE UPDATE ON public.retailer_products
  FOR EACH ROW EXECUTE FUNCTION public.catalog_touch_updated_at();

DROP TRIGGER IF EXISTS retailer_offers_current_touch_updated_at ON public.retailer_offers_current;
CREATE TRIGGER retailer_offers_current_touch_updated_at
  BEFORE UPDATE ON public.retailer_offers_current
  FOR EACH ROW EXECUTE FUNCTION public.catalog_touch_updated_at();

ALTER TABLE public.catalog_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_discovered_urls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_collector_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_fetches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retailer_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retailer_offers_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retailer_price_observations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.catalog_sources FROM anon, authenticated;
REVOKE ALL ON TABLE public.catalog_discovered_urls FROM anon, authenticated;
REVOKE ALL ON TABLE public.catalog_collector_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.catalog_fetches FROM anon, authenticated;
REVOKE ALL ON TABLE public.retailer_products FROM anon, authenticated;
REVOKE ALL ON TABLE public.retailer_offers_current FROM anon, authenticated;
REVOKE ALL ON TABLE public.retailer_price_observations FROM anon, authenticated;

GRANT ALL ON TABLE public.catalog_sources TO service_role;
GRANT ALL ON TABLE public.catalog_discovered_urls TO service_role;
GRANT ALL ON TABLE public.catalog_collector_runs TO service_role;
GRANT ALL ON TABLE public.catalog_fetches TO service_role;
GRANT ALL ON TABLE public.retailer_products TO service_role;
GRANT ALL ON TABLE public.retailer_offers_current TO service_role;
GRANT ALL ON TABLE public.retailer_price_observations TO service_role;

INSERT INTO public.catalog_sources (retailer_id, display_name, base_url, sitemap_url, enabled)
VALUES ('billa', 'BILLA', 'https://www.billa.cz', 'https://www.billa.cz/sitemap.xml', true)
ON CONFLICT (retailer_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  base_url = EXCLUDED.base_url,
  sitemap_url = EXCLUDED.sitemap_url,
  enabled = EXCLUDED.enabled,
  updated_at = now();

COMMENT ON TABLE public.catalog_fetches IS 'Immutable RAW source evidence index; payload bytes live in private Storage bucket catalog-raw.';
COMMENT ON TABLE public.retailer_products IS 'Retailer-native normalized product catalog. Canonical cross-retailer matching is a separate layer.';
COMMENT ON TABLE public.retailer_offers_current IS 'Latest observed offer per retailer product.';
COMMENT ON TABLE public.retailer_price_observations IS 'One latest price observation per Prague calendar day and retailer product.';
