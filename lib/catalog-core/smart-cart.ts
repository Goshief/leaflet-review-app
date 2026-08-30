import type { SupabaseClient } from "@supabase/supabase-js";
import { getOffersForCanonicalIds } from "./repository";

export type SmartCartItem = {
  canonicalProductId: string;
  quantity: number;
};

export type SmartCartOfferOption = {
  canonicalProductId: string;
  retailer: string;
  price: number;
  loyaltyPrice?: number | null;
  retailerProductId?: string;
  sourceUrl?: string | null;
};

export type SmartCartSelection = {
  canonicalProductId: string;
  retailer: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  retailerProductId?: string;
  sourceUrl?: string | null;
};

function combinations<T>(values: T[], size: number) {
  const result: T[][] = [];
  const visit = (start: number, current: T[]) => {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < values.length; i += 1) {
      current.push(values[i]);
      visit(i + 1, current);
      current.pop();
    }
  };
  visit(0, []);
  return result;
}

function positiveQuantity(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function optimizeSmartCart(
  rawItems: SmartCartItem[],
  rawOffers: SmartCartOfferOption[],
  options?: {
    maxStores?: number;
    allowedRetailers?: string[];
    includeLoyaltyPrices?: boolean;
  }
) {
  const items = rawItems.map((item) => ({ ...item, quantity: positiveQuantity(item.quantity) }));
  const maxStores = Math.max(1, Math.min(3, Math.floor(options?.maxStores ?? 1)));
  const allowed = options?.allowedRetailers?.length
    ? new Set(options.allowedRetailers.map((value) => value.toLowerCase()))
    : null;
  const offers = rawOffers.filter((offer) => offer.price >= 0 && (!allowed || allowed.has(offer.retailer.toLowerCase())));
  const requiredIds = new Set(items.map((item) => item.canonicalProductId));
  const relevantOffers = offers.filter((offer) => requiredIds.has(offer.canonicalProductId));
  const retailers = [...new Set(relevantOffers.map((offer) => offer.retailer))].sort();

  const effectivePrice = (offer: SmartCartOfferOption) => {
    if (options?.includeLoyaltyPrices && offer.loyaltyPrice != null && offer.loyaltyPrice >= 0) {
      return Math.min(offer.price, offer.loyaltyPrice);
    }
    return offer.price;
  };

  let best: { total: number; stores: string[]; selections: SmartCartSelection[] } | null = null;

  for (let storeCount = 1; storeCount <= Math.min(maxStores, retailers.length); storeCount += 1) {
    for (const storeSet of combinations(retailers, storeCount)) {
      const stores = new Set(storeSet);
      const selections: SmartCartSelection[] = [];
      let total = 0;
      let complete = true;

      for (const item of items) {
        const candidates = relevantOffers
          .filter((offer) => offer.canonicalProductId === item.canonicalProductId && stores.has(offer.retailer))
          .sort((a, b) => effectivePrice(a) - effectivePrice(b));
        const chosen = candidates[0];
        if (!chosen) {
          complete = false;
          break;
        }
        const unitPrice = effectivePrice(chosen);
        const lineTotal = Math.round(unitPrice * item.quantity * 100) / 100;
        total += lineTotal;
        selections.push({
          canonicalProductId: item.canonicalProductId,
          retailer: chosen.retailer,
          unitPrice,
          quantity: item.quantity,
          lineTotal,
          retailerProductId: chosen.retailerProductId,
          sourceUrl: chosen.sourceUrl,
        });
      }

      if (!complete) continue;
      total = Math.round(total * 100) / 100;
      if (
        !best ||
        total < best.total ||
        (total === best.total && storeSet.length < best.stores.length) ||
        (total === best.total && storeSet.length === best.stores.length && storeSet.join("|") < best.stores.join("|"))
      ) {
        best = { total, stores: storeSet, selections };
      }
    }
  }

  const availableProductIds = new Set(relevantOffers.map((offer) => offer.canonicalProductId));
  const unavailableProductIds = items
    .map((item) => item.canonicalProductId)
    .filter((id) => !availableProductIds.has(id));

  return {
    ok: Boolean(best),
    maxStores,
    total: best?.total ?? null,
    stores: best?.stores ?? [],
    selections: best?.selections ?? [],
    unavailableProductIds: [...new Set(unavailableProductIds)],
  };
}

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
