import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/public-env";
import { LEAFLET_PATHNAME_HEADER } from "@/lib/auth/request-path";
import { applySecurityHeaders } from "@/lib/security/headers";

const SESSION_CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

const CLAIMS_TIMEOUT_MS = 5000;

function nextWithPathname(request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers);
  const pathWithSearch = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  requestHeaders.set(LEAFLET_PATHNAME_HEADER, pathWithSearch);
  return applySecurityHeaders(NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  }));
}

async function verifyClaimsWithoutFreezing(operation: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLAIMS_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Authorization remains fail-closed in page/API guards.
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = nextWithPathname(request);

  const env = getPublicSupabaseEnv();
  if (!env) return supabaseResponse;

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = nextWithPathname(request);
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        Object.entries(SESSION_CACHE_HEADERS).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      },
    },
  });

  await verifyClaimsWithoutFreezing(supabase.auth.getClaims());
  return supabaseResponse;
}
