import { NextRequest, NextResponse } from "next/server";
import { addCartItem, getOrCreateActiveCart, listCartItems } from "@/lib/shopper/service";
import { resolveShopperUserId } from "@/lib/shopper/identity";

export async function GET(req: NextRequest) {
  const userId = resolveShopperUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Chybí shopper session (cart_session cookie)." }, { status: 401 });

  try {
    const cart = await getOrCreateActiveCart(userId);
    const items = await listCartItems(cart.id);
    return NextResponse.json({ ok: true, cart, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "cart_load_failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { requested_name?: string; quantity?: number; preferred_store_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON body." }, { status: 400 });
  }

  const userId = resolveShopperUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Chybí shopper session (cart_session cookie)." }, { status: 401 });

  try {
    const cart = await getOrCreateActiveCart(userId);
    if (!body.requested_name) return NextResponse.json({ ok: true, cart, created: false });

    const quantity = Number(body.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ ok: false, error: "quantity musí být kladné číslo." }, { status: 400 });
    }

    const item = await addCartItem({
      cartId: cart.id,
      requestedName: body.requested_name.trim(),
      quantity,
      preferredStoreId: body.preferred_store_id ?? null,
    });
    return NextResponse.json({ ok: true, cart, item, created: true }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "cart_create_failed" }, { status: 500 });
  }
}
