import { NextRequest, NextResponse } from "next/server";
import { addCartItem, getOrCreateActiveCart } from "@/lib/shopper/service";
import { resolveShopperUserId } from "@/lib/shopper/identity";

export async function POST(req: NextRequest) {
  let body: { requested_name?: string; quantity?: number; preferred_store_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON body." }, { status: 400 });
  }

  const userId = resolveShopperUserId(req);
  const requestedName = (body.requested_name ?? "").trim();
  const quantity = Number(body.quantity ?? 1);

  if (!userId) {
    return NextResponse.json({ ok: false, error: "Chybí shopper session (cart_session cookie)." }, { status: 401 });
  }
  if (!requestedName) {
    return NextResponse.json({ ok: false, error: "requested_name je povinné." }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ ok: false, error: "quantity musí být kladné číslo." }, { status: 400 });
  }

  try {
    const cart = await getOrCreateActiveCart(userId);
    const item = await addCartItem({
      cartId: cart.id,
      requestedName,
      quantity,
      preferredStoreId: body.preferred_store_id ?? null,
    });
    return NextResponse.json({ ok: true, cart_id: cart.id, item }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "cart_item_add_failed" }, { status: 500 });
  }
}
