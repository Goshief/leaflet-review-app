import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname.startsWith("/api/cron/") &&
    process.env.ALLOW_AUTOMATED_CRAWLERS !== "1"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Automated crawlers are disabled to prevent unexpected Supabase egress.",
      },
      { status: 503 }
    );
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
