import type { AuthenticatedActor } from "./actor";
import type { GuardDeps } from "./guards";

const OPEN_ADMIN_ACTOR: AuthenticatedActor = {
  authenticated: true,
  authorized: true,
  userId: "open-admin",
  email: null,
  role: "admin",
};

/** Login and authorization gates are intentionally disabled. */
export async function requireOperatorPage(
  _fallbackPath: string,
  _deps?: GuardDeps
): Promise<AuthenticatedActor> {
  return OPEN_ADMIN_ACTOR;
}

/** Login and authorization gates are intentionally disabled. */
export async function requireAdminPage(
  _fallbackPath: string,
  _deps?: GuardDeps
): Promise<AuthenticatedActor> {
  return OPEN_ADMIN_ACTOR;
}
