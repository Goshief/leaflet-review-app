-- Page images for archived original PDFs. Identity is batch_id + page_id; page_no is per-batch only.

ALTER TABLE public.leaflet_pdf_intake
  DROP CONSTRAINT IF EXISTS leaflet_pdf_intake_status_check;

ALTER TABLE public.leaflet_pdf_intake
  ADD CONSTRAINT leaflet_pdf_intake_status_check
  CHECK (status IN ('downloaded', 'download_failed', 'duplicate', 'pages_ready', 'pages_failed'));

CREATE UNIQUE INDEX IF NOT EXISTS leaflet_pdf_intake_batch_id_uidx
  ON public.leaflet_pdf_intake (batch_id);

CREATE TABLE IF NOT EXISTS public.leaflet_pdf_pages (
  page_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.leaflet_pdf_intake (batch_id) ON DELETE CASCADE,
  store_id text NOT NULL,
  page_no integer NOT NULL CHECK (page_no >= 1),
  image_storage_path text NOT NULL,
  width integer,
  height integer,
  rendered_at timestamptz,
  processing_status text NOT NULL DEFAULT 'rendered'
    CHECK (processing_status IN ('rendered', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, page_no)
);

CREATE INDEX IF NOT EXISTS leaflet_pdf_pages_batch_idx
  ON public.leaflet_pdf_pages (batch_id, page_no);

DROP TRIGGER IF EXISTS leaflet_pdf_pages_updated_at ON public.leaflet_pdf_pages;
CREATE TRIGGER leaflet_pdf_pages_updated_at
  BEFORE UPDATE ON public.leaflet_pdf_pages
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.leaflet_pdf_pages IS 'Jedna vyrenderovaná stránka originálního PDF. Stránky různých letáků se nemíchají: vždy batch_id + page_id.';

ALTER TABLE public.leaflet_pdf_pages ENABLE ROW LEVEL SECURITY;
