import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/public-env";
import { signOutFlow } from "@/lib/auth/logout";
import { requireSameOrigin } from "@/lib/auth/same-origin";
import { applySecurityHeaders } from "@/lib/security/headers";

export const dynamic = "force-dynamic";

function noStoreRedirect(request: Request, pathname: string): NextResponse {
  const response = NextResponse.redirect(new URL(pathname, request.url), {
    status: 303,
  });
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return applySecurityHeaders(response);
}

/**
 * Logout must be POST (or a server action). GET is intentionally unsupported.
 */
export async function POST(request: Request) {
  const sameOrigin = requireSameOrigin(request);
  if (!sameOrigin.ok) {
    return applySecurityHeaders(NextResponse.json(
      { ok: false, error: "Forbidden" },
      {
        status: 403,
        headers: { "Cache-Control": "private, no-store" },
      }
    ));
  }

  if (!getPublicSupabaseEnv()) {
    return noStoreRedirect(request, "/login");
  }

  try {
    const client = await createClient();
    await signOutFlow(client);
  } catch {
    // Repeated logout must not error.
  }

  return noStoreRedirect(request, "/login");
}

export async function GET() {
  return applySecurityHeaders(NextResponse.json(
    { ok: false, error: "Method Not Allowed" },
    {
      status: 405,
      headers: {
        Allow: "POST",
        "Cache-Control": "private, no-store",
      },
    }
  ));
}
