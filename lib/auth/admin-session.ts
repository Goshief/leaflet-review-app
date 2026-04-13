import { cookies } from "next/headers";

export const ADMIN_SESSION_COOKIE = "admin_session";

function requiredAdminEmail() {
  return (process.env.ADMIN_LOGIN_EMAIL ?? "").trim().toLowerCase();
}

function requiredAdminPassword() {
  return (process.env.ADMIN_LOGIN_PASSWORD ?? "").trim();
}

export function isAdminEnvConfigured(): boolean {
  return Boolean(requiredAdminEmail() && requiredAdminPassword());
}

export function validateAdminCredentials(email: string, password: string): boolean {
  const e = email.trim().toLowerCase();
  const p = password;
  return e.length > 0 && p.length > 0 && e === requiredAdminEmail() && p === requiredAdminPassword();
}

export async function hasAdminSession(): Promise<boolean> {
  const store = await cookies();
  const v = store.get(ADMIN_SESSION_COOKIE)?.value ?? "";
  return v === "1";
}
