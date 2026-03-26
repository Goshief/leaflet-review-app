-- Letáky Admin + Setřík: jedna DB, oddělené tabulky.
-- Spusť v Supabase: SQL Editor → vložit, nebo: supabase db push

-- Úložiště PDF (soukromý bucket)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'leaflet-pdfs',
  'leaflet-pdfs',
  false,
  52428800,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Dávky / letáky (admin workflow)
CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer text NOT NULL CHECK (retailer IN ('lidl', 'kaufland', 'albert', 'billa')),
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

CREATE INDEX IF NOT EXISTS import_batches_status_idx ON public.import_batches (status);
CREATE INDEX IF NOT EXISTS import_batches_created_at_idx ON public.import_batches (created_at DESC);

-- Návrhy k ověření (výstup parseru + kontrola)
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

CREATE INDEX IF NOT EXISTS offers_staging_batch_page_idx ON public.offers_staging (batch_id, page_no);
CREATE INDEX IF NOT EXISTS offers_staging_review_idx ON public.offers_staging (batch_id, review_status);

-- Jeden záznam dokončeného importu z dávky
CREATE TABLE IF NOT EXISTS public.imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL UNIQUE REFERENCES public.import_batches (id) ON DELETE CASCADE,
  offers_imported_count integer NOT NULL DEFAULT 0,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

-- Finální nabídky pro Setřík (čtení hotových dat)
CREATE TABLE IF NOT EXISTS public.offers_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.imports (id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.import_batches (id) ON DELETE CASCADE,
  staging_offer_id uuid REFERENCES public.offers_staging (id) ON DELETE SET NULL,
  page_no integer NOT NULL,
  store_id text NOT NULL,
  source_type text NOT NULL DEFAULT 'leaflet',
  valid_from date,
  valid_to date,
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
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offers_raw_batch_idx ON public.offers_raw (batch_id);
CREATE INDEX IF NOT EXISTS offers_raw_import_idx ON public.offers_raw (import_id);

-- Zamítnuté / problematické (audit)
CREATE TABLE IF NOT EXISTS public.offers_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches (id) ON DELETE CASCADE,
  staging_offer_id uuid REFERENCES public.offers_staging (id) ON DELETE SET NULL,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offers_quarantine_batch_idx ON public.offers_quarantine (batch_id);

-- updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS import_batches_updated_at ON public.import_batches;
CREATE TRIGGER import_batches_updated_at
  BEFORE UPDATE ON public.import_batches
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS offers_staging_updated_at ON public.offers_staging;
CREATE TRIGGER offers_staging_updated_at
  BEFORE UPDATE ON public.offers_staging
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.import_batches IS 'Admin: dávky letáků (jedna řádka = jeden nahraný PDF proces).';
COMMENT ON TABLE public.offers_staging IS 'Admin: návrhy k ověření (parser + lidská kontrola).';
COMMENT ON TABLE public.imports IS 'Admin: dokončený import schválených řádků do finální vrstvy.';
COMMENT ON TABLE public.offers_raw IS 'Setřík: finální nabídky po importu (čtení).';
COMMENT ON TABLE public.offers_quarantine IS 'Admin: zamítnuté nebo nevalidní řádky.';

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers_quarantine ENABLE ROW LEVEL SECURITY;

-- Klient s service_role obchází RLS; pro přihlášené adminy doplníš později politiky.
