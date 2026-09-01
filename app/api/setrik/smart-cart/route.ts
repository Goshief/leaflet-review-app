import { NextResponse } from "next/server";
import { buildSmartCartPlan } from "@/lib/catalog-core/smart-cart";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  items?: Array<{ canonicalProductId?: unknown; quantity?: unknown }>;
  maxStores?: unknown;
  allowedRetailers?: unknown;
  includeLoyaltyPrices?: unknown;
};

export async function POST(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "Databáze není nakonfigurovaná." }, { status: 503 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Očekávám JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
    return NextResponse.json({ ok: false, error: "items musí obsahovat 1 až 50 položek." }, { status: 400 });
  }

  const items = body.items.map((item) => ({
    canonicalProductId: typeof item.canonicalProductId === "string" ? item.canonicalProductId.trim() : "",
    quantity: typeof item.quantity === "number" ? item.quantity : Number(item.quantity ?? 1),
  }));
  if (items.some((item) => !item.canonicalProductId || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1000)) {
    return NextResponse.json({ ok: false, error: "Neplatné ID produktu nebo množství." }, { status: 400 });
  }

  const maxStores = typeof body.maxStores === "number" ? body.maxStores : Number(body.maxStores ?? 1);
  if (!Number.isFinite(maxStores) || maxStores < 1 || maxStores > 3) {
    return NextResponse.json({ ok: false, error: "maxStores musí být 1, 2 nebo 3." }, { status: 400 });
  }

  const allowedRetailers = Array.isArray(body.allowedRetailers)
    ? body.allowedRetailers.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).slice(0, 30)
    : undefined;

  try {
    const plan = await buildSmartCartPlan(supabase, items, {
      maxStores,
      allowedRetailers,
      includeLoyaltyPrices: body.includeLoyaltyPrices === true,
    });
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    console.error("[setrik-smart-cart]", error);
    return NextResponse.json({ ok: false, error: "Chytrý košík není momentálně dostupný." }, { status: 503 });
  }
}
