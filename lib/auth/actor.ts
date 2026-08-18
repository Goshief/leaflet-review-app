import { getAuthenticatedUser, type AuthClaimsClient } from "./identity.ts";
import {
  parseOperatorRole,
  roleAllowsAdminAccess,
  roleAllowsOperatorAccess,
  type OperatorRole,
} from "./roles.ts";

export type AuthenticatedActor = {
  authenticated: true;
  authorized: true;
  userId: string;
  email: string | null;
  role: OperatorRole;
};

export type UnauthorizedActor = {
  authenticated: boolean;
  authorized: false;
  reason:
    | "missing_config"
    | "unauthenticated"
    | "invalid_token"
    | "missing_role"
    | "invalid_role";
};

export type AuthActor = AuthenticatedActor | UnauthorizedActor;
export type AuthActorClient = AuthClaimsClient;

function deny(
  authenticated: boolean,
  reason: UnauthorizedActor["reason"]
): UnauthorizedActor {
  return { authenticated, authorized: false, reason };
}

/**
 * Resolve an operator/admin from cryptographically verified JWT claims.
 * This deliberately avoids auth.getUser(), because that endpoint is backed by
 * the Auth database and must not block every admin page when Postgres is slow.
 * Role changes take effect when the access token is refreshed.
 */
export async function getAuthenticatedActor(
  client: AuthActorClient | null
): Promise<AuthActor> {
  if (!client) return deny(false, "missing_config");

  const identity = await getAuthenticatedUser(client);
  if (!identity.authenticated) {
    if (identity.reason === "missing_config") return deny(false, "missing_config");
    if (identity.reason === "invalid_token") return deny(false, "invalid_token");
    return deny(false, "unauthenticated");
  }

  const role = parseOperatorRole(identity.appMetadata);
  if (!role) {
    const rawRole =
      typeof identity.appMetadata === "object" &&
      identity.appMetadata !== null &&
      !Array.isArray(identity.appMetadata)
        ? (identity.appMetadata as Record<string, unknown>).role
        : undefined;
    return deny(true, rawRole === undefined ? "missing_role" : "invalid_role");
  }

  return {
    authenticated: true,
    authorized: true,
    userId: identity.userId,
    email: identity.email,
    role,
  };
}

export function actorAllowsOperatorAccess(actor: AuthActor): boolean {
  return actor.authorized === true && roleAllowsOperatorAccess(actor.role);
}

export function actorAllowsAdminAccess(actor: AuthActor): boolean {
  return actor.authorized === true && roleAllowsAdminAccess(actor.role);
}
