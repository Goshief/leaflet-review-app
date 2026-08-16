import { signInWithPasswordFlow, GENERIC_LOGIN_ERROR } from "@/lib/auth/login";
import { loginJsonResponse } from "@/lib/auth/login-http";
import {
  clearSuccessfulLoginRateLimit,
  consumeLoginRateLimit,
  LOGIN_RATE_LIMIT_ERROR,
  LOGIN_UNAVAILABLE_ERROR,
} from "@/lib/auth/login-rate-limit";
import { requireSameOrigin } from "@/lib/auth/same-origin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getPublicSupabaseEnv } from "@/lib/supabase/public-env";
import { createClient } from "@/lib/supabase/server";

type LoginBody = {
  email: unknown;
  password: unknown;
  next: unknown;
};

function failure(error: string, status: number, headers?: HeadersInit) {
  return loginJsonResponse({ ok: false, error }, status, headers);
}

async function readLoginBody(request: Request): Promise<LoginBody | null> {
  try {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
      const body: unknown = await request.json();
      if (!body || typeof body !== "object") return null;
      const candidate = body as Record<string, unknown>;
      return {
        email: candidate.email,
        password: candidate.password,
        next: candidate.next,
      };
    }

    const form = await request.formData();
    return {
      email: form.get("email"),
      password: form.get("password"),
      next: form.get("next"),
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!requireSameOrigin(request).ok) {
    return failure(GENERIC_LOGIN_ERROR, 403);
  }

  const body = await readLoginBody(request);
  if (!body) return failure(GENERIC_LOGIN_ERROR, 400);
  if (
    typeof body.email !== "string" ||
    body.email.trim().length === 0 ||
    typeof body.password !== "string" ||
    body.password.length === 0
  ) {
    return failure(GENERIC_LOGIN_ERROR, 400);
  }

  let limiterClient;
  try {
    limiterClient = getSupabaseAdmin();
  } catch {
    return failure(LOGIN_UNAVAILABLE_ERROR, 503);
  }
  if (!limiterClient) return failure(LOGIN_UNAVAILABLE_ERROR, 503);

  let limit;
  try {
    limit = await consumeLoginRateLimit(limiterClient, {
      email: body.email,
      headers: request.headers,
    });
  } catch {
    return failure(LOGIN_UNAVAILABLE_ERROR, 503);
  }

  if (!limit.ok) {
    if (limit.code === "rate_limited") {
      return failure(LOGIN_RATE_LIMIT_ERROR, 429, {
        "Retry-After": String(Math.max(1, limit.retryAfter)),
      });
    }
    return failure(LOGIN_UNAVAILABLE_ERROR, 503);
  }

  if (!getPublicSupabaseEnv()) return failure(LOGIN_UNAVAILABLE_ERROR, 503);

  let authClient;
  try {
    authClient = await createClient();
  } catch {
    return failure(LOGIN_UNAVAILABLE_ERROR, 503);
  }

  let result;
  try {
    result = await signInWithPasswordFlow(authClient, body);
  } catch {
    return failure(LOGIN_UNAVAILABLE_ERROR, 503);
  }
  if (!result.ok) return failure(result.error, result.code === "invalid_input" ? 400 : 401);

  await clearSuccessfulLoginRateLimit(limiterClient, limit.emailKeyHash);
  return loginJsonResponse({ ok: true, redirectTo: result.redirectTo }, 200);
}

export async function GET() {
  return loginJsonResponse(
    { ok: false, error: "Method Not Allowed" },
    405,
    { Allow: "POST" }
  );
}
