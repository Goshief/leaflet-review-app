-- 3-pass AI verification metadata on staging offers.

ALTER TABLE public.offers_staging
  ADD COLUMN IF NOT EXISTS ai_checks jsonb;

COMMENT ON COLUMN public.offers_staging.ai_checks IS 'Interní 3-pass AI metadata (passes, per-field status/agreement, bbox). Nikdy auto-approve.';
