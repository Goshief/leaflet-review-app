-- Re-read audit: each AI reread creates a new parser_run. Old runs stay.

ALTER TABLE public.offers_staging
  ADD COLUMN IF NOT EXISTS field_sources jsonb,
  ADD COLUMN IF NOT EXISTS ai_proposal jsonb,
  ADD COLUMN IF NOT EXISTS parser_run_id uuid REFERENCES public.leaflet_parser_runs (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.offers_staging.field_sources IS 'Per-field source: ai | human. Human values are never silently overwritten by reread.';
COMMENT ON COLUMN public.offers_staging.ai_proposal IS 'AI návrh pro pole se source=human. Lidská hodnota zůstává.';

CREATE TABLE IF NOT EXISTS public.leaflet_parser_reruns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  previous_run_id uuid REFERENCES public.leaflet_parser_runs (id) ON DELETE SET NULL,
  new_run_id uuid NOT NULL REFERENCES public.leaflet_parser_runs (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  model_version text,
  parser_version text NOT NULL,
  adapter_version text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('page', 'product'))
);

CREATE INDEX IF NOT EXISTS leaflet_parser_reruns_new_run_idx
  ON public.leaflet_parser_reruns (new_run_id);

CREATE INDEX IF NOT EXISTS leaflet_parser_reruns_previous_run_idx
  ON public.leaflet_parser_reruns (previous_run_id);

COMMENT ON TABLE public.leaflet_parser_reruns IS 'Audit AI re-read: previous_run_id + new_run_id. Starý parser_run se nemaže.';

ALTER TABLE public.leaflet_parser_reruns ENABLE ROW LEVEL SECURITY;
