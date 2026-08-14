import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/public-env";

const SESSION_CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

/**
 * Refresh / verify the Auth session for the current request.
 *
 * Point 02/04: Proxy only maintains the SSR session (getClaims + cookies).
 * Definitive operator/admin authorization runs in page layouts and each
 * sensitive API Route Handler via requireOperatorApi / requireAdminApi —
 * Proxy is not the sole authorization layer and does not re-fetch the Auth user.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const env = getPublicSupabaseEnv();
  if (!env) {
    return supabaseResponse;
  }

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        // @supabase/ssr 0.9.x (peer-compatible with supabase-js 2.100.0) does not
        // pass cache headers into setAll; apply them manually per advanced guide.
        Object.entries(SESSION_CACHE_HEADERS).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      },
    },
  });

  // Validates / refreshes the JWT. Do not authorize from an unverified session user object.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
