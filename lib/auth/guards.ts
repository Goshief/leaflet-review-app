import { NextResponse } from "next/server.js";
import {
  getAuthenticatedActor,
  type AuthActorClient,
  type AuthenticatedActor,
} from "./actor.ts";
import {
  roleAllowsAdminAccess,
  roleAllowsOperatorAccess,
} from "./roles.ts";
import { makeRequestId, safeErrorJson, type SafeErrorCode } from "../api/safe-error.ts";
import { getPublicSupabaseEnv } from "../supabase/public-env.ts";

export type ApiGuardOk = {
  ok: true;
  actor: AuthenticatedActor;
};

export type ApiGuardErr = {
  ok: false;
  response: NextResponse;
};

export type ApiGuardResult = ApiGuardOk | ApiGuardErr;

export type GuardDeps = {
  /** Injected Auth client for tests. `undefined` → create server SSR client. */
  client?: AuthActorClient | null;
  requestId?: string;
  /** Lazy server client factory (production). */
  createServerClient?: () => Promise<AuthActorClient>;
};

const NO_STORE = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const;

function withNoStore(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(NO_STORE)) {
    response.headers.set(key, value);
  }
  return response;
}

function authError(
  status: number,
  code: SafeErrorCode,
  message: string,
  requestId?: string
): NextResponse {
  return withNoStore(
    safeErrorJson({
      status,
      code,
      message,
      requestId: requestId ?? makeRequestId(),
      logContext: { auth_guard: true },
    })
  );
}

export async function resolveGuardClient(
  deps?: GuardDeps
): Promise<AuthActorClient | null> {
  if (deps && "client" in deps) {
    return deps.client ?? null;
  }
  if (!getPublicSupabaseEnv()) {
    return null;
  }
  if (deps?.createServerClient) {
    try {
      return await deps.createServerClient();
    } catch {
      return null;
    }
  }
  try {
    const { createClient } = await import("../supabase/server.ts");
    return (await createClient()) as unknown as AuthActorClient;
  } catch {
    return null;
  }
}

function apiDenyFromActor(
  actor: Awaited<ReturnType<typeof getAuthenticatedActor>>,
  need: "operator" | "admin",
  requestId?: string
): ApiGuardErr | null {
  if (!actor.authenticated) {
    return {
      ok: false,
      response: authError(
        401,
        "UNAUTHORIZED",
        "Přihlášení je vyžadováno.",
        requestId
      ),
    };
  }

  if (!actor.authorized) {
    return {
      ok: false,
      response: authError(
        403,
        "FORBIDDEN",
        "Nemáte oprávnění k této operaci.",
        requestId
      ),
    };
  }

  const allowed =
    need === "admin"
      ? roleAllowsAdminAccess(actor.role)
      : roleAllowsOperatorAccess(actor.role);

  if (!allowed) {
    return {
      ok: false,
      response: authError(
        403,
        "FORBIDDEN",
        "Nemáte oprávnění k této operaci.",
        requestId
      ),
    };
  }

  return null;
}

/**
 * API guard: operator or admin. Call before body parse / service-role / AI.
 */
export async function requireOperatorApi(deps?: GuardDeps): Promise<ApiGuardResult> {
  const requestId = deps?.requestId ?? makeRequestId();
  const client = await resolveGuardClient(deps);
  const actor = await getAuthenticatedActor(client);
  const denied = apiDenyFromActor(actor, "operator", requestId);
  if (denied) return denied;
  return { ok: true, actor: actor as AuthenticatedActor };
}

/**
 * API guard: admin only.
 */
export async function requireAdminApi(deps?: GuardDeps): Promise<ApiGuardResult> {
  const requestId = deps?.requestId ?? makeRequestId();
  const client = await resolveGuardClient(deps);
  const actor = await getAuthenticatedActor(client);
  const denied = apiDenyFromActor(actor, "admin", requestId);
  if (denied) return denied;
  return { ok: true, actor: actor as AuthenticatedActor };
}

/** Pure helper for tests — maps actor + need → HTTP status without Next redirect. */
export function evaluateAccess(
  actor: Awaited<ReturnType<typeof getAuthenticatedActor>>,
  need: "operator" | "admin"
): { status: 200 | 401 | 403; actor?: AuthenticatedActor } {
  if (!actor.authenticated) return { status: 401 };
  if (!actor.authorized) return { status: 403 };
  const allowed =
    need === "admin"
      ? roleAllowsAdminAccess(actor.role)
      : roleAllowsOperatorAccess(actor.role);
  if (!allowed) return { status: 403 };
  return { status: 200, actor };
}
