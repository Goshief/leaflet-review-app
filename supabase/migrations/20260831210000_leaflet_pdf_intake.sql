-- Original leaflet PDF archive. Watcher downloads go here; processing never overwrites original.pdf.
-- Service role writes; public/client access is denied.

CREATE TABLE IF NOT EXISTS public.leaflet_pdf_intake (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL DEFAULT gen_random_uuid(),
  store_id text NOT NULL,
  source_url text,
  pdf_source_url text,
  pdf_storage_path text,
  pdf_sha256 text,
  pdf_size_bytes bigint,
  downloaded_at timestamptz,
  valid_from date,
  valid_to date,
  status text NOT NULL CHECK (status IN ('downloaded', 'download_failed', 'duplicate')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leaflet_pdf_intake_sha256_uidx
  ON public.leaflet_pdf_intake (pdf_sha256)
  WHERE pdf_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS leaflet_pdf_intake_store_status_idx
  ON public.leaflet_pdf_intake (store_id, status, downloaded_at DESC);

CREATE INDEX IF NOT EXISTS leaflet_pdf_intake_retry_idx
  ON public.leaflet_pdf_intake (store_id, pdf_source_url)
  WHERE status = 'download_failed';

DROP TRIGGER IF EXISTS leaflet_pdf_intake_updated_at ON public.leaflet_pdf_intake;
CREATE TRIGGER leaflet_pdf_intake_updated_at
  BEFORE UPDATE ON public.leaflet_pdf_intake
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.leaflet_pdf_intake IS 'Archiv originálních PDF letáků. Jeden SHA-256 = jeden import. download_failed zachová URL pro další cron.';

ALTER TABLE public.leaflet_pdf_intake ENABLE ROW LEVEL SECURITY;
