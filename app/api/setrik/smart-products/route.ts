import { NextResponse } from "next/server";
import { listSmartProducts } from "@/lib/catalog-core/smart-products";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: true, configured: false, products: [], total: 0 });
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 30);
  try {
    const products = await listSmartProducts(supabase, {
      q: url.searchParams.get("q"),
      category: url.searchParams.get("category"),
      limit: Number.isFinite(limit) ? limit : 30,
    });
    return NextResponse.json({ ok: true, configured: true, products, total: products.length });
  } catch (error) {
    console.error("[setrik-smart-products]", error);
    return NextResponse.json({ ok: false, error: "Chytré produkty nejsou momentálně dostupné." }, { status: 503 });
  }
}
