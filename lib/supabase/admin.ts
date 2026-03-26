import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

/**
 * Server-only klient s oprávněním služby (obchází RLS).
 * Vyžaduje NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.info("[supabase-admin-init]", {
    has_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    has_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    node_env: process.env.NODE_ENV,
  });

  if (!url || !key) {
    throw new Error("SUPABASE_ENV_MISSING");
  }

  try {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.info("[supabase-admin] init ok", {
      has_url: true,
      has_service_role_key: true,
    });
    return cached;
  } catch (e) {
    console.error("[supabase-admin] init failed", {
      has_url: Boolean(url),
      has_service_role_key: Boolean(key),
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

