-- Repair the runtime schema required by the automatic leaflet parser.
-- This migration is intentionally idempotent because production may have only
-- a subset of older admin/parser migrations applied.

CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer text NOT NULL,
  source_url text,
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded' CHECK (
    status IN ('uploaded', 'processing', 'review', 'imported', 'error')
  ),
  page_count integer,
  product_count integer,
  approved_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  pending_review_count integer NOT NULL DEFAULT 0,
  error_message text,
  pipeline_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

ALTER TABLE public.import_batches
  DROP CONSTRAINT IF EXISTS import_batches_retailer_check;

ALTER TABLE public.import_batches
  ADD CONSTRAINT import_batches_retailer_check
  CHECK (retailer IN (
    'albert', 'billa', 'dm', 'globus', 'kaufland', 'kosik',
    'lidl', 'penny', 'rohlik', 'rossmann', 'tesco', 'teta'
  ));

CREATE TABLE IF NOT EXISTS public.leaflet_parser_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.leaflet_pdf_intake (batch_id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES public.leaflet_pdf_pages (page_id) ON DELETE CASCADE,
  page_no integer NOT NULL,
  store_id text NOT NULL,
  adapter text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'parsed', 'failed', 'needs_review')),
  model text,
  error_message text,
  validation_errors jsonb,
  raw_output text,
  offer_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS leaflet_parser_runs_page_idx
  ON public.leaflet_parser_runs (page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leaflet_parser_runs_batch_idx
  ON public.leaflet_parser_runs (batch_id, page_no);

CREATE TABLE IF NOT EXISTS public.offers_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches (id) ON DELETE CASCADE,
  page_no integer NOT NULL,
  store_id text NOT NULL DEFAULT 'lidl',
  source_type text NOT NULL DEFAULT 'leaflet',
  valid_from date,
  valid_to date,
  valid_from_text text,
  valid_to_text text,
  extracted_name text,
  price_total numeric(12, 2),
  currency text NOT NULL DEFAULT 'CZK',
  pack_qty integer,
  pack_unit text,
  pack_unit_qty integer,
  price_standard numeric(12, 2),
  typical_price_per_unit numeric(12, 2),
  price_with_loyalty_card numeric(12, 2),
  has_loyalty_card_price boolean,
  notes text,
  brand text,
  category text,
  raw_text_block text,
  review_status text NOT NULL DEFAULT 'pending' CHECK (
    review_status IN ('pending', 'approved', 'rejected', 'needs_review')
  ),
  reviewed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_comment text,
  pipeline_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.offers_staging
  ADD COLUMN IF NOT EXISTS page_id uuid REFERENCES public.leaflet_pdf_pages (page_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_checks jsonb,
  ADD COLUMN IF NOT EXISTS field_sources jsonb,
  ADD COLUMN IF NOT EXISTS ai_proposal jsonb,
  ADD COLUMN IF NOT EXISTS parser_run_id uuid REFERENCES public.leaflet_parser_runs (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS offers_staging_batch_page_idx
  ON public.offers_staging (batch_id, page_no);
CREATE INDEX IF NOT EXISTS offers_staging_review_idx
  ON public.offers_staging (batch_id, review_status);
CREATE INDEX IF NOT EXISTS offers_staging_page_id_idx
  ON public.offers_staging (page_id);

ALTER TABLE public.leaflet_parser_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers_staging ENABLE ROW LEVEL SECURITY;
