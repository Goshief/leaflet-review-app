import { NextResponse } from "next/server";
import { getSmartProductDetail } from "@/lib/catalog-core/smart-products";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseConstraint(value: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: true, configured: false, product: null });
  const { id } = await context.params;
  const url = new URL(request.url);
  const constraints: Record<string, string | number | boolean> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (!key.startsWith("attr.")) continue;
    const attributeKey = key.slice(5).trim();
    if (attributeKey) constraints[attributeKey] = parseConstraint(value);
  }

  try {
    const product = await getSmartProductDetail(supabase, id, constraints);
    if (!product) return NextResponse.json({ ok: false, error: "Chytrý produkt nebyl nalezen." }, { status: 404 });
    return NextResponse.json({ ok: true, configured: true, product });
  } catch (error) {
    console.error("[setrik-smart-product-detail]", error);
    return NextResponse.json({ ok: false, error: "Chytrý produkt není momentálně dostupný." }, { status: 503 });
  }
}
