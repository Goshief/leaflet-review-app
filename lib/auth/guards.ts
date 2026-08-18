import type { AuthActorClient, AuthenticatedActor } from "./actor.ts";

export type ApiGuardOk = {
  ok: true;
  actor: AuthenticatedActor;
};

export type ApiGuardErr = {
  ok: false;
  response: never;
};

export type ApiGuardResult = ApiGuardOk | ApiGuardErr;

export type GuardDeps = {
  client?: AuthActorClient | null;
  requestId?: string;
  createServerClient?: () => Promise<AuthActorClient>;
};

const OPEN_ADMIN_ACTOR: AuthenticatedActor = {
  authenticated: true,
  authorized: true,
  userId: "open-admin",
  email: null,
  role: "admin",
};

/** Authentication is intentionally disabled for this app. */
export async function resolveGuardClient(
  _deps?: GuardDeps
): Promise<AuthActorClient | null> {
  return null;
}

/** API access is intentionally open; no login is required. */
export async function requireOperatorApi(_deps?: GuardDeps): Promise<ApiGuardResult> {
  return { ok: true, actor: OPEN_ADMIN_ACTOR };
}

/** API access is intentionally open; no login is required. */
export async function requireAdminApi(_deps?: GuardDeps): Promise<ApiGuardResult> {
  return { ok: true, actor: OPEN_ADMIN_ACTOR };
}

/** Pure helper retained for compatibility with existing tests/callers. */
export function evaluateAccess(
  _actor: unknown,
  _need: "operator" | "admin"
): { status: 200; actor: AuthenticatedActor } {
  return { status: 200, actor: OPEN_ADMIN_ACTOR };
}
