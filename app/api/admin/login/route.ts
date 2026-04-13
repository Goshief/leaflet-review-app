import { NextRequest, NextResponse } from "next/server";
import {
  getSupabasePublishableKey,
  isSupabaseAuthConfigured,
  SUPABASE_ACCESS_TOKEN_COOKIE,
  SUPABASE_REFRESH_TOKEN_COOKIE,
  userHasAdminRole,
} from "@/lib/auth/admin-session";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON body." }, { status: 400 });
  }

  if (!isSupabaseAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Admin login není nakonfigurovaný (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)." },
      { status: 503 }
    );
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishable = getSupabasePublishableKey();
  const signInRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: publishable,
    },
    body: JSON.stringify({ email, password }),
  });

  const session = await signInRes.json().catch(() => null);
  if (!signInRes.ok || !session?.access_token || !session?.refresh_token || !session?.user) {
    return NextResponse.json({ ok: false, error: "Neplatné přihlašovací údaje." }, { status: 401 });
  }

  if (!userHasAdminRole(session.user)) {
    return NextResponse.json({ ok: false, error: "Účet nemá admin oprávnění." }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  const maxAge = Number.isFinite(session.expires_in) ? Math.max(60, Number(session.expires_in)) : 60 * 60;

  res.cookies.set(SUPABASE_ACCESS_TOKEN_COOKIE, session.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  res.cookies.set(SUPABASE_REFRESH_TOKEN_COOKIE, session.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
