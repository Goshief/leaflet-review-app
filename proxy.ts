import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/cron/")) {
    const manual = request.nextUrl.searchParams.get("manual") === "1";
    const secret = process.env.CRON_SECRET?.trim();
    const auth = request.headers.get("authorization") || "";

    // Scheduled runs must be genuine Vercel Cron requests. Manual operator
    // runs are still allowed through and are authorized by the route itself.
    if (!manual && (!secret || auth !== `Bearer ${secret}`)) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized cron request." },
        { status: 401 }
      );
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static Next assets, images, favicon,
     * and common public file extensions. Admin pages stay in the matcher so
     * point 04 can add route guards without changing the exclusion list.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|webmanifest)$).*)",
  ],
};
