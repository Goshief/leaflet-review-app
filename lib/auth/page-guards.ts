import type { AuthenticatedActor } from "./actor";
import type { GuardDeps } from "./guards";

const OPEN_ADMIN_ACTOR: AuthenticatedActor = {
  authenticated: true,
  authorized: true,
  userId: "open-admin",
  email: null,
  role: "admin",
};

/**
 * Authentication is intentionally disabled for this app.
 * Admin pages are directly accessible without login.
 */
export async function requireOperatorPage(
  _fallbackPath: string,
  _deps?: GuardDeps
): Promise<AuthenticatedActor> {
  return OPEN_ADMIN_ACTOR;
}

/**
 * Authentication is intentionally disabled for this app.
 * Admin-only pages are directly accessible without login.
 */
export async function requireAdminPage(
  _fallbackPath: string,
  _deps?: GuardDeps
): Promise<AuthenticatedActor> {
  return OPEN_ADMIN_ACTOR;
}
