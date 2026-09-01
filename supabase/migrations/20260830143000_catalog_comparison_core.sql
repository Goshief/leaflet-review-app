-- Comparison core: retailer-native products -> canonical products -> smart/generic products.
-- Server routes access these tables through service_role. No direct browser access.

CREATE TABLE IF NOT EXISTS public.canonical_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_key text NOT NULL UNIQUE,
  name text NOT NULL,
  normalized_name text NOT NULL,
  brand text,
  brand_normalized text,
  gtin text,
  quantity_value numeric(14, 4),
  quantity_unit text,
  quantity_base_value numeric(14, 4),
  quantity_base_unit text,
  category text,
  subcategory text,
  image_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS canonical_products_gtin_unique_idx
  ON public.canonical_products (gtin)
  WHERE gtin IS NOT NULL AND gtin <> '';
CREATE INDEX IF NOT EXISTS canonical_products_name_idx
  ON public.canonical_products (normalized_name);
CREATE INDEX IF NOT EXISTS canonical_products_brand_idx
  ON public.canonical_products (brand_normalized);
CREATE INDEX IF NOT EXISTS canonical_products_category_idx
  ON public.canonical_products (category, subcategory);

CREATE TABLE IF NOT EXISTS public.product_matches (
  retailer_product_id uuid PRIMARY KEY REFERENCES public.retailer_products (id) ON DELETE CASCADE,
  canonical_product_id uuid NOT NULL REFERENCES public.canonical_products (id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('gtin', 'exact_key', 'scored', 'seed', 'manual')),
  confidence numeric(5, 4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'auto' CHECK (status IN ('auto', 'confirmed', 'review')),
  matched_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_matches_canonical_idx
  ON public.product_matches (canonical_product_id);

CREATE TABLE IF NOT EXISTS public.product_match_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_product_id uuid NOT NULL REFERENCES public.retailer_products (id) ON DELETE CASCADE,
  candidate_canonical_product_id uuid NOT NULL REFERENCES public.canonical_products (id) ON DELETE CASCADE,
  confidence numeric(5, 4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (retailer_product_id, candidate_canonical_product_id)
);
CREATE INDEX IF NOT EXISTS product_match_candidates_pending_idx
  ON public.product_match_candidates (status, confidence DESC);

CREATE TABLE IF NOT EXISTS public.generic_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  normalized_name text NOT NULL,
  category text,
  description text,
  default_constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generic_products_category_idx
  ON public.generic_products (category, active);

CREATE TABLE IF NOT EXISTS public.generic_product_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generic_product_id uuid NOT NULL REFERENCES public.generic_products (id) ON DELETE CASCADE,
  canonical_product_id uuid NOT NULL REFERENCES public.canonical_products (id) ON DELETE CASCADE,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generic_product_id, canonical_product_id)
);
CREATE INDEX IF NOT EXISTS generic_product_members_generic_idx
  ON public.generic_product_members (generic_product_id, enabled);
CREATE INDEX IF NOT EXISTS generic_product_members_attributes_idx
  ON public.generic_product_members USING gin (attributes);

DROP TRIGGER IF EXISTS canonical_products_touch_updated_at ON public.canonical_products;
CREATE TRIGGER canonical_products_touch_updated_at
  BEFORE UPDATE ON public.canonical_products
  FOR EACH ROW EXECUTE FUNCTION public.catalog_touch_updated_at();

DROP TRIGGER IF EXISTS product_matches_touch_updated_at ON public.product_matches;
CREATE TRIGGER product_matches_touch_updated_at
  BEFORE UPDATE ON public.product_matches
  FOR EACH ROW EXECUTE FUNCTION public.catalog_touch_updated_at();

DROP TRIGGER IF EXISTS generic_products_touch_updated_at ON public.generic_products;
CREATE TRIGGER generic_products_touch_updated_at
  BEFORE UPDATE ON public.generic_products
  FOR EACH ROW EXECUTE FUNCTION public.catalog_touch_updated_at();

DROP TRIGGER IF EXISTS generic_product_members_touch_updated_at ON public.generic_product_members;
CREATE TRIGGER generic_product_members_touch_updated_at
  BEFORE UPDATE ON public.generic_product_members
  FOR EACH ROW EXECUTE FUNCTION public.catalog_touch_updated_at();

ALTER TABLE public.canonical_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_match_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generic_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generic_product_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.canonical_products FROM anon, authenticated;
REVOKE ALL ON TABLE public.product_matches FROM anon, authenticated;
REVOKE ALL ON TABLE public.product_match_candidates FROM anon, authenticated;
REVOKE ALL ON TABLE public.generic_products FROM anon, authenticated;
REVOKE ALL ON TABLE public.generic_product_members FROM anon, authenticated;

GRANT ALL ON TABLE public.canonical_products TO service_role;
GRANT ALL ON TABLE public.product_matches TO service_role;
GRANT ALL ON TABLE public.product_match_candidates TO service_role;
GRANT ALL ON TABLE public.generic_products TO service_role;
GRANT ALL ON TABLE public.generic_product_members TO service_role;

COMMENT ON TABLE public.canonical_products IS 'Cross-retailer identity used for price comparison. One canonical product can have offers from many retailer_products.';
COMMENT ON TABLE public.product_matches IS 'Authoritative retailer-product to canonical-product link with auditable match method and confidence.';
COMMENT ON TABLE public.product_match_candidates IS 'Ambiguous similarity matches requiring later review; never silently treated as authoritative.';
COMMENT ON TABLE public.generic_products IS 'Smart-product definition such as Mozzarella independent of brand/retailer.';
COMMENT ON TABLE public.generic_product_members IS 'Allowed canonical variants of a smart/generic product with filterable JSON attributes.';
