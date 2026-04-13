CREATE TABLE IF NOT EXISTS public.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'checked_out', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS carts_user_active_uq
  ON public.carts (user_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES public.carts (id) ON DELETE CASCADE,
  requested_name text NOT NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  preferred_store_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cart_items_cart_id_idx ON public.cart_items (cart_id);
CREATE INDEX IF NOT EXISTS cart_items_requested_name_idx ON public.cart_items (lower(requested_name));

CREATE TABLE IF NOT EXISTS public.shopping_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES public.carts (id) ON DELETE CASCADE,
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'replaced')),
  baseline_total numeric(12,2),
  optimized_total numeric(12,2),
  savings_total numeric(12,2),
  unavailable_items_count integer NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shopping_plans_cart_generated_idx
  ON public.shopping_plans (cart_id, generated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS shopping_plans_cart_active_uq
  ON public.shopping_plans (cart_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.shopping_plans (id) ON DELETE CASCADE,
  cart_item_id uuid NOT NULL REFERENCES public.cart_items (id) ON DELETE CASCADE,
  chosen_offer_id uuid REFERENCES public.offers_raw (id) ON DELETE SET NULL,
  requested_name text NOT NULL,
  quantity numeric(12,3) NOT NULL,
  baseline_unit_price numeric(12,2),
  optimized_unit_price numeric(12,2),
  baseline_total numeric(12,2),
  optimized_total numeric(12,2),
  savings_total numeric(12,2),
  store_id text,
  unavailable_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plan_items_plan_id_idx ON public.plan_items (plan_id);
CREATE INDEX IF NOT EXISTS plan_items_offer_idx ON public.plan_items (chosen_offer_id);

DROP TRIGGER IF EXISTS carts_updated_at ON public.carts;
CREATE TRIGGER carts_updated_at
  BEFORE UPDATE ON public.carts
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS cart_items_updated_at ON public.cart_items;
CREATE TRIGGER cart_items_updated_at
  BEFORE UPDATE ON public.cart_items
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS shopping_plans_updated_at ON public.shopping_plans;
CREATE TRIGGER shopping_plans_updated_at
  BEFORE UPDATE ON public.shopping_plans
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS plan_items_updated_at ON public.plan_items;
CREATE TRIGGER plan_items_updated_at
  BEFORE UPDATE ON public.plan_items
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_items ENABLE ROW LEVEL SECURITY;
