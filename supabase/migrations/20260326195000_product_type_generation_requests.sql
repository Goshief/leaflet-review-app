CREATE TABLE IF NOT EXISTS public.product_type_generation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_item_id text NOT NULL,
  import_id uuid NOT NULL REFERENCES public.imports (id) ON DELETE CASCADE,
  source_table text NOT NULL CHECK (source_table IN ('offers_raw', 'offers_quarantine')),
  product_name text,
  candidate_image_key text,
  source text NOT NULL DEFAULT 'leaflet-review-app',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_type_generation_requests_lookup_idx
  ON public.product_type_generation_requests (batch_item_id, import_id, source_table, source, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS product_type_generation_requests_pending_uq
  ON public.product_type_generation_requests (batch_item_id, import_id, source_table, source)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS product_type_generation_requests_updated_at ON public.product_type_generation_requests;
CREATE TRIGGER product_type_generation_requests_updated_at
  BEFORE UPDATE ON public.product_type_generation_requests
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.product_type_generation_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.product_type_generation_requests IS 'Požadavky z UI na doplnění/generování product-type assetu.';
