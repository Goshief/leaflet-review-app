import { NextRequest, NextResponse } from "next/server";
import { deleteCartItem, updateCartItem } from "@/lib/shopper/service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  let body: { quantity?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON body." }, { status: 400 });
  }

  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ ok: false, error: "quantity musí být kladné číslo." }, { status: 400 });
  }

  try {
    const item = await updateCartItem(itemId, quantity);
    if (!item) return NextResponse.json({ ok: false, error: "Položka nenalezena." }, { status: 404 });
    return NextResponse.json({ ok: true, item });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "cart_item_update_failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  try {
    const ok = await deleteCartItem(itemId);
    if (!ok) return NextResponse.json({ ok: false, error: "Položka nenalezena." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "cart_item_delete_failed" }, { status: 500 });
  }
}
