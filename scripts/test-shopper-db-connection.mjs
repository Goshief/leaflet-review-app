import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for shopper Supabase test.");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function mustTable(table) {
  const r = await supabase.from(table).select("id").limit(1);
  if (r.error) throw new Error(`${table}: ${r.error.message}`);
}

try {
  await mustTable("carts");
  await mustTable("cart_items");
  await mustTable("shopping_plans");
  await mustTable("plan_items");
  await mustTable("offers_raw");

  const cartInsert = await supabase
    .from("carts")
    .insert({ user_id: "shopper-supabase-smoke", status: "active" })
    .select("id")
    .single();
  if (cartInsert.error || !cartInsert.data) throw new Error(cartInsert.error?.message ?? "cart insert failed");

  const itemInsert = await supabase
    .from("cart_items")
    .insert({ cart_id: cartInsert.data.id, requested_name: "Smoke test", quantity: 1 })
    .select("id")
    .single();

  if (itemInsert.error || !itemInsert.data) throw new Error(itemInsert.error?.message ?? "item insert failed");

  await supabase.from("cart_items").delete().eq("id", itemInsert.data.id);
  await supabase.from("carts").delete().eq("id", cartInsert.data.id);

  assert.ok(itemInsert.data.id);
  console.log("OK: shopper Supabase connectivity + CRUD smoke passed");
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
