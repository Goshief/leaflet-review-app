import { NextRequest, NextResponse } from "next/server";
import { getActivePlanForUser } from "@/lib/shopper/service";
import { resolveShopperUserId } from "@/lib/shopper/identity";

export async function GET(req: NextRequest) {
  const userId = resolveShopperUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Chybí shopper session (cart_session cookie)." }, { status: 401 });

  try {
    const plan = await getActivePlanForUser(userId);
    if (!plan) return NextResponse.json({ ok: true, summary: null });

    return NextResponse.json({
      ok: true,
      summary: {
        plan_id: plan.id,
        baseline_total: plan.baseline_total,
        optimized_total: plan.optimized_total,
        savings_total: plan.savings_total,
        unavailable_items_count: plan.unavailable_items_count,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "savings_load_failed" }, { status: 500 });
  }
}
