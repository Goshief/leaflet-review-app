import { NextResponse } from "next/server";
import { getCanonicalProductDetail } from "@/lib/catalog-core/repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: true, configured: false, product: null });
  const { id } = await context.params;
  if (!id) return NextResponse.json({ ok: false, error: "Chybí ID produktu." }, { status: 400 });

  try {
    const product = await getCanonicalProductDetail(supabase, id);
    if (!product) return NextResponse.json({ ok: false, error: "Produkt nebyl nalezen." }, { status: 404 });
    return NextResponse.json({ ok: true, configured: true, product });
  } catch (error) {
    console.error("[setrik-product-detail]", error);
    return NextResponse.json({ ok: false, error: "Detail produktu není momentálně dostupný." }, { status: 503 });
  }
}
