import type { SupabaseClient } from "@supabase/supabase-js";
import { getOffersForCanonicalIds } from "./repository";
import {
  optimizeSmartCart,
  type SmartCartItem,
  type SmartCartOfferOption,
} from "./smart-cart-optimizer.ts";

export { optimizeSmartCart } from "./smart-cart-optimizer.ts";
export type { SmartCartItem, SmartCartOfferOption, SmartCartSelection } from "./smart-cart-optimizer.ts";

export async function buildSmartCartPlan(
  supabase: SupabaseClient,
  items: SmartCartItem[],
  options?: {
    maxStores?: number;
    allowedRetailers?: string[];
    includeLoyaltyPrices?: boolean;
  }
) {
  const ids = [...new Set(items.map((item) => item.canonicalProductId).filter(Boolean))];
  const offerMap = await getOffersForCanonicalIds(supabase, ids);
  const offers: SmartCartOfferOption[] = [];
  for (const [canonicalProductId, rows] of offerMap.entries()) {
    for (const row of rows) {
      if (!row.available || row.price == null) continue;
      offers.push({
        canonicalProductId,
        retailer: row.retailer,
        price: row.price,
        loyaltyPrice: row.loyalty_price,
        retailerProductId: row.retailer_product_id,
        sourceUrl: row.source_url,
      });
    }
  }
  return optimizeSmartCart(items, offers, options);
}
