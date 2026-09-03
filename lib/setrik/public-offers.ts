import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { unstable_cache } from "next/cache";
import { mapCatalogOfferRow, type SetrikPublicOffer } from "./map-catalog-offer";

export type { SetrikPublicOffer } from "./map-catalog-offer";

export type SetrikPublicOffersResult = {
  ok: boolean;
  configured: boolean;
  source_table: string | null;
  offers: SetrikPublicOffer[];
  total: number;
  message?: string;
};

type AnyRow = Record<string, unknown>;

const QUERY_TIMEOUT_MS = 5_000;
const MAX_HOMEPAGE_ROWS = 120;
const SOURCE_TABLE = "retailer_offers_current + retailer_products";

async function querySetrikPublicOffers(limit = 20): Promise<SetrikPublicOffersResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return {
      ok: false,
      configured: false,
      source_table: null,
      offers: [],
      total: 0,
      message: "Databáze produktů není nakonfigurovaná.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const safeLimit = Math.max(1, Math.min(limit, MAX_HOMEPAGE_ROWS));
    const result = await supabase
      .from("retailer_offers_current")
      .select(`
        retailer_product_id,
        retailer_id,
        price,
        regular_price,
        loyalty_price,
        unit_price,
        unit_basis,
        currency,
        source_url,
        observed_at,
        updated_at,
        retailer_products!inner (
          id,
          retailer_id,
          name,
          brand,
          quantity_value,
          quantity_unit,
          image_url,
          category,
          source_url,
          last_seen_at
        )
      `)
      .eq("available", true)
      .not("price", "is", null)
      .order("updated_at", { ascending: false })
      .limit(safeLimit)
      .abortSignal(controller.signal);

    if (result.error) throw new Error(result.error.message);
    const offers = Array.isArray(result.data)
      ? (result.data as unknown as AnyRow[]).map(mapCatalogOfferRow)
      : [];
    return { ok: true, configured: true, source_table: SOURCE_TABLE, offers, total: offers.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[setrik-public-offers] web catalog read failed", { error: message });
    return {
      ok: false,
      configured: true,
      source_table: SOURCE_TABLE,
      offers: [],
      total: 0,
      message: "Databáze produktů je dočasně nedostupná. Zkoušíme to znovu automaticky.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export const getSetrikPublicOffers = unstable_cache(
  querySetrikPublicOffers,
  ["setrik-web-catalog-offers-v1"],
  { revalidate: 300 }
);
