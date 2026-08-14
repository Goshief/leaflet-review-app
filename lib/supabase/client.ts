import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "@/lib/supabase/public-env";

/**
 * Browser Supabase client — only URL + publishable (or legacy anon) key.
 * Must never receive or import the service-role secret.
 */
export function createClient() {
  const env = getPublicSupabaseEnv();
  if (!env) {
    throw new Error("Supabase Auth není nakonfigurovaný (chybí URL nebo publishable key).");
  }

  return createBrowserClient(env.url, env.publishableKey);
}

/**
 * Lazy browser singleton for existing public helpers (e.g. storage URLs).
 * createBrowserClient itself is already a process singleton.
 */
function getLegacyBrowserClient() {
  const env = getPublicSupabaseEnv();
  if (!env) {
    // Preserve prior createClient(url!, key!) behaviour for callers that only
    // need public URL helpers when env is partially present at build time.
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        ""
    );
  }
  return createBrowserClient(env.url, env.publishableKey);
}

/** @deprecated Prefer createClient(); kept for existing public Storage helpers. */
export const supabase = getLegacyBrowserClient();
