-- Automatic per-page AI parser: parser_runs + staging identity + page statuses.

ALTER TABLE public.leaflet_pdf_pages
  DROP CONSTRAINT IF EXISTS leaflet_pdf_pages_processing_status_check;

ALTER TABLE public.leaflet_pdf_pages
  ADD CONSTRAINT leaflet_pdf_pages_processing_status_check
  CHECK (processing_status IN ('rendered', 'queued', 'parsing', 'parsed', 'failed', 'needs_review'));

ALTER TABLE public.import_batches
  DROP CONSTRAINT IF EXISTS import_batches_retailer_check;

ALTER TABLE public.import_batches
  ADD CONSTRAINT import_batches_retailer_check
  CHECK (retailer IN ('lidl', 'kaufland', 'albert', 'billa', 'penny'));

ALTER TABLE public.offers_staging
  ADD COLUMN IF NOT EXISTS page_id uuid REFERENCES public.leaflet_pdf_pages (page_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS offers_staging_page_id_idx
  ON public.offers_staging (page_id);

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

COMMENT ON TABLE public.leaflet_parser_runs IS 'Jeden AI parser request = jedna stránka (batch_id + page_id). Invalidní JSON nikdy neposouvá sloupce; jde sem jako failed/needs_review.';

ALTER TABLE public.leaflet_parser_runs ENABLE ROW LEVEL SECURITY;
