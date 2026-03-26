import { NextResponse } from "next/server";

/**
 * Pro statickou `public/product-types/gallery.html` — stejný origin, žádné tajemství
 * (NEXT_PUBLIC_* je už veřejné v klientu).
 */
export function GET() {
  return NextResponse.json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  });
}
