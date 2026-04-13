import { NextRequest, NextResponse } from "next/server";
import { getSupabasePublishableKey, SUPABASE_ACCESS_TOKEN_COOKIE, SUPABASE_REFRESH_TOKEN_COOKIE } from "@/lib/auth/admin-session";

export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get(SUPABASE_ACCESS_TOKEN_COOKIE)?.value ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const publishable = getSupabasePublishableKey();
  if (supabaseUrl && publishable && accessToken) {
    await fetch(`${supabaseUrl}/auth/v1/logout`, {
      method: "POST",
      headers: {
        apikey: publishable,
        Authorization: `Bearer ${accessToken}`,
      },
    }).catch(() => null);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SUPABASE_ACCESS_TOKEN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  res.cookies.set(SUPABASE_REFRESH_TOKEN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
