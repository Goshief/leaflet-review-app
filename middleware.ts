import { NextRequest, NextResponse } from "next/server";
import { getSupabasePublishableKey, SUPABASE_ACCESS_TOKEN_COOKIE, userHasAdminRole } from "@/lib/auth/admin-session";

const protectedPrefixes = [
  "/batches",
  "/review",
  "/quarantine",
  "/history",
  "/settings",
  "/image-generation-requests",
  "/parsers",
  "/product-types",
  "/upload",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = protectedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  const accessToken = req.cookies.get(SUPABASE_ACCESS_TOKEN_COOKIE)?.value ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const publishable = getSupabasePublishableKey();
  if (!accessToken || !supabaseUrl || !publishable) return toLogin(req);

  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: publishable,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });
    const user = await userRes.json().catch(() => null);
    if (userRes.ok && userHasAdminRole(user)) return NextResponse.next();
  } catch {
    // continue to login redirect
  }

  return toLogin(req);
}

export const config = {
  matcher: [
    "/batches/:path*",
    "/review/:path*",
    "/quarantine/:path*",
    "/history/:path*",
    "/settings/:path*",
    "/image-generation-requests/:path*",
    "/parsers/:path*",
    "/product-types/:path*",
    "/upload/:path*",
  ],
};

function toLogin(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}
