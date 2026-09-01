import { NextResponse } from "next/server";
import { listCanonicalProducts } from "@/lib/catalog-core/repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: true, configured: false, products: [], total: 0 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 30);
  try {
    const products = await listCanonicalProducts(supabase, {
      q: url.searchParams.get("q"),
      brand: url.searchParams.get("brand"),
      category: url.searchParams.get("category"),
      retailer: url.searchParams.get("retailer"),
      discountedOnly: url.searchParams.get("discounted") === "1" || url.searchParams.get("discounted") === "true",
      limit: Number.isFinite(limit) ? limit : 30,
    });
    return NextResponse.json({ ok: true, configured: true, products, total: products.length });
  } catch (error) {
    console.error("[setrik-products]", error);
    return NextResponse.json({ ok: false, error: "Produktový katalog není momentálně dostupný." }, { status: 503 });
  }
}
