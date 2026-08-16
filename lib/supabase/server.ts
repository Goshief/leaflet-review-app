import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseEnv } from "@/lib/supabase/public-env";

/**
 * Request-scoped server Supabase client using Auth cookies (SSR).
 * Does not use the service-role key.
 */
export async function createClient() {
  const env = getPublicSupabaseEnv();
  if (!env) {
    throw new Error("Supabase Auth není nakonfigurovaný (chybí URL nebo publishable key).");
  }

  const cookieStore = await cookies();

  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
          // Response cache headers cannot be set via cookieStore; Proxy +
          // login/logout routes apply Cache-Control when cookies change.
        } catch {
          // Called from a Server Component where cookies cannot be set.
          // Proxy refreshes the session on subsequent requests.
        }
      },
    },
  });
}
