import { NextResponse } from "next/server";
import { getSetrikPublicOffers } from "@/lib/setrik/public-offers";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";

export const runtime = "nodejs";
export const revalidate = 30;

export async function GET(request: Request) {
  const requestId = makeRequestId();
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "60");
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 200) : 60;

  try {
    const data = await getSetrikPublicOffers(limit);
    return NextResponse.json({
      ...data,
      requestId,
      env: {
        has_supabase_url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        has_service_role_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      },
    });
  } catch (e) {
    return safeErrorJson({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Nepodařilo se načíst veřejné nabídky ze Supabase.",
      requestId,
      cause: e,
      logContext: { route: "/api/setrik/offers" },
    });
  }
}
