import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, isAdminEnvConfigured, validateAdminCredentials } from "@/lib/auth/admin-session";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON body." }, { status: 400 });
  }

  if (!isAdminEnvConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Admin login není nakonfigurovaný (ADMIN_LOGIN_EMAIL / ADMIN_LOGIN_PASSWORD)." },
      { status: 503 }
    );
  }

  const email = (body.email ?? "").trim();
  const password = body.password ?? "";

  if (!validateAdminCredentials(email, password)) {
    return NextResponse.json({ ok: false, error: "Neplatné přihlašovací údaje." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
