import { NextRequest, NextResponse } from "next/server";

const protectedPrefixes = [
  "/batches",
  "/review",
  "/quarantine",
  "/history",
  "/settings",
  "/image-generation-requests",
  "/parsers",
  "/product-types",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = protectedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  const session = req.cookies.get("admin_session")?.value;
  if (session === "1") return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/batches/:path*", "/review/:path*", "/quarantine/:path*", "/history/:path*", "/settings/:path*", "/image-generation-requests/:path*", "/parsers/:path*", "/product-types/:path*"],
};
