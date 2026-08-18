import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type SetrikPublicOffer = {
  id: string;
  name: string;
  store: string | null;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  price: number | null;
  regular_price: number | null;
  loyalty_price: number | null;
  currency: string;
  unit: string | null;
  valid_from: string | null;
  valid_to: string | null;
  image_url: string | null;
  source: string;
  created_at: string | null;
};

export type SetrikPublicOffersResult =
  | {
      ok: true;
      configured: true;
      source_table: string;
      offers: SetrikPublicOffer[];
      total: number;
    }
  | {
      ok: true;
      configured: false;
      source_table: null;
      offers: [];
      total: 0;
      message: string;
    };

type AnyRow = Record<string, unknown>;

const QUERY_TIMEOUT_MS = 2500;
const MAX_HOMEPAGE_ROWS = 20;

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Number(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function first<T>(...values: Array<T | null | undefined | "">): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value as T;
  }
  return null;
}

function mapOfferRow(row: AnyRow): SetrikPublicOffer {
  return {
    id: str(row.id) ?? crypto.randomUUID(),
    name: first(str(row.extracted_name), str(row.product_name), str(row.name)) ?? "Produkt",
    store: first(str(row.store_id), str(row.store), str(row.retailer)),
    category: first(str(row.category_canonical), str(row.category)),
    subcategory: first(str(row.subcategory_canonical), str(row.subcategory)),
    brand: str(row.brand),
    price: first(num(row.price_total), num(row.price), num(row.action_price)),
    regular_price: first(num(row.price_standard), num(row.regular_price)),
    loyalty_price: first(num(row.price_with_loyalty_card), num(row.loyalty_price)),
    currency: first(str(row.currency), "CZK") ?? "CZK",
    unit: first(str(row.normalized_price_unit), str(row.unit_price_unit), str(row.pack_unit)),
    valid_from: str(row.valid_from),
    valid_to: str(row.valid_to),
    image_url: str(row.image_url),
    source: "offers_raw",
    created_at: first(str(row.inserted_at), str(row.created_at)),
  };
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Public homepage is intentionally circuit-broken by default while the primary
 * database is under load. Admin/auth routes must never compete with expensive
 * public feed reads. Set HOMEPAGE_DB_READS_ENABLED=true after DB health is
 * restored to re-enable the small, cancellable query below.
 */
export async function getSetrikPublicOffers(limit = 20): Promise<SetrikPublicOffersResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return {
      ok: true,
      configured: false,
      source_table: null,
      offers: [],
      total: 0,
      message: "Supabase není nakonfigurovaný.",
    };
  }

  if (process.env.HOMEPAGE_DB_READS_ENABLED !== "true") {
    return {
      ok: true,
      configured: true,
      source_table: "offers_raw",
      offers: [],
      total: 0,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const today = todayIsoDate();
    const safeLimit = Math.max(1, Math.min(limit, MAX_HOMEPAGE_ROWS));
    const result = await supabase
      .from("offers_raw")
      .select("id,store_id,extracted_name,brand,category,subcategory,category_canonical,subcategory_canonical,price_total,price_standard,price_with_loyalty_card,currency,pack_unit,normalized_price_unit,image_url,valid_from,valid_to,inserted_at,created_at")
      .gte("valid_to", today)
      .or(`valid_from.is.null,valid_from.lte.${today}`)
      .eq("price_public_blocked", false)
      .eq("review_status", "ok")
      .not("extracted_name", "is", null)
      .order("inserted_at", { ascending: false })
      .limit(safeLimit)
      .abortSignal(controller.signal);

    if (result.error || !Array.isArray(result.data)) {
      return { ok: true, configured: true, source_table: "offers_raw", offers: [], total: 0 };
    }

    const offers = (result.data as AnyRow[]).map(mapOfferRow);
    return { ok: true, configured: true, source_table: "offers_raw", offers, total: offers.length };
  } catch {
    return { ok: true, configured: true, source_table: "offers_raw", offers: [], total: 0 };
  } finally {
    clearTimeout(timer);
  }
}
