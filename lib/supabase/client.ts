import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "@/lib/supabase/public-env";

/**
 * Browser Supabase client — only URL + publishable (or legacy anon) key.
 * Must never receive or import the service-role secret.
 *
 * The client is created lazily. This is important for Next.js prerender/CI:
 * importing this module must not require Supabase environment variables.
 */
export function createClient() {
  const env = getPublicSupabaseEnv();
  if (!env) {
    throw new Error("Supabase Auth není nakonfigurovaný (chybí URL nebo publishable key).");
  }

  return createBrowserClient(env.url, env.publishableKey);
}

/**
 * Backwards-compatible lazy proxy for existing callers that import `supabase`.
 * No Supabase client is instantiated during module evaluation, so `next build`
 * can prerender pages in CI even when public Supabase env vars are absent.
 */
type BrowserClient = ReturnType<typeof createBrowserClient>;
let legacyClient: BrowserClient | null = null;

function getLegacyBrowserClient(): BrowserClient {
  if (!legacyClient) {
    legacyClient = createClient();
  }
  return legacyClient;
}

/** @deprecated Prefer createClient(); kept for existing public Storage helpers. */
export const supabase = new Proxy({} as BrowserClient, {
  get(_target, property, receiver) {
    return Reflect.get(getLegacyBrowserClient(), property, receiver);
  },
});
