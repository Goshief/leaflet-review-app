import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/cron/")) {
    const secret = process.env.CRON_SECRET?.trim();
    const auth = request.headers.get("authorization") || "";

    // Cron routes may write catalog, storage, or processing data. Every call
    // must carry the server-side secret; manual operator actions go through
    // /api/admin/leaflets/run, which adds it after checking the user session.
    if (!secret || auth !== `Bearer ${secret}`) {
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
