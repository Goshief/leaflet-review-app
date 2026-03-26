ALTER TABLE public.product_type_generation_requests
  ADD COLUMN IF NOT EXISTS resolved_image_key text,
  ADD COLUMN IF NOT EXISTS error_note text;

