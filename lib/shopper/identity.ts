import type { NextRequest } from "next/server";

export function resolveShopperUserId(req: NextRequest): string | null {
  const fromCookie = req.cookies.get("cart_session")?.value?.trim();
  if (fromCookie) return fromCookie;

  const fromHeader = req.headers.get("x-shopper-session")?.trim();
  if (fromHeader) return fromHeader;

  return null;
}
