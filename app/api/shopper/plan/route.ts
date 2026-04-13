import { NextRequest, NextResponse } from "next/server";
import { generateOrRecomputePlanForUser, getActivePlanForUser } from "@/lib/shopper/service";
import { resolveShopperUserId } from "@/lib/shopper/identity";

export async function GET(req: NextRequest) {
  const userId = resolveShopperUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Chybí shopper session (cart_session cookie)." }, { status: 401 });

  try {
    const plan = await getActivePlanForUser(userId);
    if (!plan) return NextResponse.json({ ok: true, plan: null });
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "plan_load_failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON body." }, { status: 400 });
  }

  const userId = resolveShopperUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Chybí shopper session (cart_session cookie)." }, { status: 401 });

  try {
    const result = await generateOrRecomputePlanForUser(userId);
    const plan = await getActivePlanForUser(userId);
    return NextResponse.json({ ok: true, recomputed: true, plan_id: result.plan_id, plan }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "plan_recompute_failed" }, { status: 500 });
  }
}
