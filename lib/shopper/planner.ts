export type OfferCandidate = {
  id: string;
  extracted_name: string;
  price_total: number;
  store_id: string | null;
};

export type CartItemInput = {
  id: string;
  requested_name: string;
  quantity: number;
};

export type PlannedItem = {
  cart_item_id: string;
  requested_name: string;
  quantity: number;
  chosen_offer_id: string | null;
  store_id: string | null;
  baseline_unit_price: number | null;
  optimized_unit_price: number | null;
  baseline_total: number | null;
  optimized_total: number | null;
  savings_total: number | null;
  unavailable_reason: string | null;
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function computePlanItem(item: CartItemInput, offers: OfferCandidate[]): PlannedItem {
  if (!offers.length) {
    return {
      cart_item_id: item.id,
      requested_name: item.requested_name,
      quantity: item.quantity,
      chosen_offer_id: null,
      store_id: null,
      baseline_unit_price: null,
      optimized_unit_price: null,
      baseline_total: null,
      optimized_total: null,
      savings_total: null,
      unavailable_reason: "no_committed_offer_match",
    };
  }

  const sorted = [...offers].sort((a, b) => a.price_total - b.price_total || a.id.localeCompare(b.id));
  const cheapest = sorted[0]!;
  const mostExpensive = sorted[sorted.length - 1]!;
  const baselineTotal = round2(mostExpensive.price_total * item.quantity);
  const optimizedTotal = round2(cheapest.price_total * item.quantity);
  const savings = round2(Math.max(0, baselineTotal - optimizedTotal));

  return {
    cart_item_id: item.id,
    requested_name: item.requested_name,
    quantity: item.quantity,
    chosen_offer_id: cheapest.id,
    store_id: cheapest.store_id,
    baseline_unit_price: round2(mostExpensive.price_total),
    optimized_unit_price: round2(cheapest.price_total),
    baseline_total: baselineTotal,
    optimized_total: optimizedTotal,
    savings_total: savings,
    unavailable_reason: null,
  };
}
