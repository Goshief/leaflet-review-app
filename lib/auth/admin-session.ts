import { cookies } from "next/headers";

export const SUPABASE_ACCESS_TOKEN_COOKIE = "sb-access-token";
export const SUPABASE_REFRESH_TOKEN_COOKIE = "sb-refresh-token";

export type AdminSupabaseUser = {
  app_metadata?: { role?: string | null; roles?: string[] | null } | null;
  user_metadata?: { role?: string | null; roles?: string[] | null } | null;
};

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && getSupabasePublishableKey());
}

export function getSupabasePublishableKey(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
}

export function getAllowedAdminRoles(): string[] {
  const raw = (process.env.ADMIN_ALLOWED_ROLES ?? "admin").trim();
  return raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

export function userHasAdminRole(user: AdminSupabaseUser | null | undefined): boolean {
  if (!user) return false;
  const allowed = new Set(getAllowedAdminRoles());
  if (!allowed.size) return false;
  const appRole = user.app_metadata?.role?.toLowerCase();
  const userRole = user.user_metadata?.role?.toLowerCase();
  const appRoles = (user.app_metadata?.roles ?? []).map((x) => x.toLowerCase());
  const userRoles = (user.user_metadata?.roles ?? []).map((x) => x.toLowerCase());
  const all = [appRole, userRole, ...appRoles, ...userRoles].filter((x): x is string => Boolean(x));
  return all.some((role) => allowed.has(role));
}

export async function hasAdminSessionCookie(): Promise<boolean> {
  const store = await cookies();
  const v = store.get(SUPABASE_ACCESS_TOKEN_COOKIE)?.value ?? "";
  return v.length > 0;
}
