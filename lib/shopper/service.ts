import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { computePlanItem, type OfferCandidate } from "@/lib/shopper/planner";

export type CartItemRow = {
  id: string;
  cart_id: string;
  requested_name: string;
  quantity: number;
  preferred_store_id: string | null;
};

function mustSupabase() {
  const sb = getSupabaseAdmin();
  if (!sb) {
    throw new Error("Supabase admin client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return sb;
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getOrCreateActiveCart(userId: string): Promise<{ id: string; user_id: string; status: string }> {
  const supabase = mustSupabase();

  const existing = await supabase
    .from("carts")
    .select("id,user_id,status")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data;

  const inserted = await supabase
    .from("carts")
    .insert({ user_id: userId, status: "active" })
    .select("id,user_id,status")
    .single();

  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? "Nepodařilo se vytvořit košík.");
  return inserted.data;
}

export async function listCartItems(cartId: string): Promise<CartItemRow[]> {
  const supabase = mustSupabase();
  const r = await supabase
    .from("cart_items")
    .select("id,cart_id,requested_name,quantity,preferred_store_id")
    .eq("cart_id", cartId)
    .order("created_at", { ascending: true });

  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []).map((row) => ({
    ...row,
    quantity: toNumber(row.quantity),
  }));
}

export async function addCartItem(args: {
  cartId: string;
  requestedName: string;
  quantity: number;
  preferredStoreId?: string | null;
}): Promise<CartItemRow> {
  const supabase = mustSupabase();
  const r = await supabase
    .from("cart_items")
    .insert({
      cart_id: args.cartId,
      requested_name: args.requestedName,
      quantity: args.quantity,
      preferred_store_id: args.preferredStoreId ?? null,
    })
    .select("id,cart_id,requested_name,quantity,preferred_store_id")
    .single();

  if (r.error || !r.data) throw new Error(r.error?.message ?? "Nepodařilo se přidat položku.");
  return { ...r.data, quantity: toNumber(r.data.quantity) };
}

export async function updateCartItem(itemId: string, quantity: number): Promise<CartItemRow | null> {
  const supabase = mustSupabase();
  const r = await supabase
    .from("cart_items")
    .update({ quantity })
    .eq("id", itemId)
    .select("id,cart_id,requested_name,quantity,preferred_store_id")
    .maybeSingle();

  if (r.error) throw new Error(r.error.message);
  if (!r.data) return null;
  return { ...r.data, quantity: toNumber(r.data.quantity) };
}

export async function deleteCartItem(itemId: string): Promise<boolean> {
  const supabase = mustSupabase();
  const existing = await supabase.from("cart_items").select("id").eq("id", itemId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (!existing.data) return false;

  const r = await supabase.from("cart_items").delete().eq("id", itemId);
  if (r.error) throw new Error(r.error.message);
  return true;
}

export async function generateOrRecomputePlanForUser(userId: string): Promise<{ plan_id: string }> {
  const supabase = mustSupabase();
  const cart = await getOrCreateActiveCart(userId);
  const items = await listCartItems(cart.id);

  await supabase
    .from("shopping_plans")
    .update({ status: "replaced" })
    .eq("cart_id", cart.id)
    .eq("status", "active");

  const insertedPlan = await supabase
    .from("shopping_plans")
    .insert({ cart_id: cart.id, user_id: userId, status: "active" })
    .select("id")
    .single();

  if (insertedPlan.error || !insertedPlan.data) {
    throw new Error(insertedPlan.error?.message ?? "Nepodařilo se vytvořit shopping plan.");
  }
  const planId = insertedPlan.data.id;

  let baselineTotal = 0;
  let optimizedTotal = 0;
  let unavailableCount = 0;

  for (const item of items) {
    const offersRes = await supabase
      .from("offers_raw")
      .select("id,extracted_name,price_total,store_id,valid_to")
      .ilike("extracted_name", item.requested_name)
      .not("price_total", "is", null);

    if (offersRes.error) throw new Error(offersRes.error.message);

    const todayIso = new Date().toISOString().slice(0, 10);
    const offers = (offersRes.data ?? [])
      .filter((o) => !o.valid_to || o.valid_to >= todayIso)
      .map(
        (o) =>
          ({
            id: o.id as string,
            extracted_name: String(o.extracted_name ?? ""),
            price_total: Number(o.price_total),
            store_id: (o.store_id as string | null) ?? null,
          }) satisfies OfferCandidate
      )
      .filter((o) => Number.isFinite(o.price_total));

    const planned = computePlanItem(
      { id: item.id, requested_name: item.requested_name, quantity: item.quantity },
      offers
    );

    if (planned.baseline_total != null) baselineTotal += planned.baseline_total;
    if (planned.optimized_total != null) optimizedTotal += planned.optimized_total;
    if (planned.unavailable_reason) unavailableCount += 1;

    const insertPlanItem = await supabase.from("plan_items").insert({
      plan_id: planId,
      cart_item_id: planned.cart_item_id,
      chosen_offer_id: planned.chosen_offer_id,
      requested_name: planned.requested_name,
      quantity: planned.quantity,
      baseline_unit_price: planned.baseline_unit_price,
      optimized_unit_price: planned.optimized_unit_price,
      baseline_total: planned.baseline_total,
      optimized_total: planned.optimized_total,
      savings_total: planned.savings_total,
      store_id: planned.store_id,
      unavailable_reason: planned.unavailable_reason,
    });

    if (insertPlanItem.error) throw new Error(insertPlanItem.error.message);
  }

  const finalBaseline = Number(baselineTotal.toFixed(2));
  const finalOptimized = Number(optimizedTotal.toFixed(2));
  const savings = Number(Math.max(0, finalBaseline - finalOptimized).toFixed(2));

  const updatePlan = await supabase
    .from("shopping_plans")
    .update({
      baseline_total: finalBaseline,
      optimized_total: finalOptimized,
      savings_total: savings,
      unavailable_items_count: unavailableCount,
    })
    .eq("id", planId);

  if (updatePlan.error) throw new Error(updatePlan.error.message);
  return { plan_id: planId };
}

export async function getActivePlanForUser(userId: string) {
  const supabase = mustSupabase();
  const planRes = await supabase
    .from("shopping_plans")
    .select("id,cart_id,baseline_total,optimized_total,savings_total,unavailable_items_count,generated_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (planRes.error) throw new Error(planRes.error.message);
  if (!planRes.data) return null;

  const itemRes = await supabase
    .from("plan_items")
    .select(
      "id,plan_id,cart_item_id,chosen_offer_id,requested_name,quantity,baseline_unit_price,optimized_unit_price,baseline_total,optimized_total,savings_total,store_id,unavailable_reason"
    )
    .eq("plan_id", planRes.data.id)
    .order("created_at", { ascending: true });

  if (itemRes.error) throw new Error(itemRes.error.message);

  return {
    ...planRes.data,
    baseline_total: planRes.data.baseline_total != null ? Number(planRes.data.baseline_total) : null,
    optimized_total: planRes.data.optimized_total != null ? Number(planRes.data.optimized_total) : null,
    savings_total: planRes.data.savings_total != null ? Number(planRes.data.savings_total) : null,
    items: (itemRes.data ?? []).map((i) => ({
      ...i,
      quantity: toNumber(i.quantity),
      baseline_unit_price: i.baseline_unit_price != null ? Number(i.baseline_unit_price) : null,
      optimized_unit_price: i.optimized_unit_price != null ? Number(i.optimized_unit_price) : null,
      baseline_total: i.baseline_total != null ? Number(i.baseline_total) : null,
      optimized_total: i.optimized_total != null ? Number(i.optimized_total) : null,
      savings_total: i.savings_total != null ? Number(i.savings_total) : null,
    })),
  };
}
