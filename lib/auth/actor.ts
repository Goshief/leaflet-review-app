import { getAuthenticatedUser, type AuthClaimsClient } from "./identity.ts";
import {
  parseOperatorRole,
  roleAllowsAdminAccess,
  roleAllowsOperatorAccess,
  type OperatorRole,
} from "./roles.ts";

/**
 * Discriminated authorization actor.
 *
 * Identity comes from verified claims (point 02). Role comes from a fresh
 * Auth-server user record (`getUser().app_metadata.role`) — never from
 * `user_metadata`, never from an unverified session user object, never from service role.
 */

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
    | "auth_server_error"
    | "user_mismatch"
    | "missing_role"
    | "invalid_role";
};

export type AuthActor = AuthenticatedActor | UnauthorizedActor;

export type AuthActorClient = AuthClaimsClient & {
  auth: AuthClaimsClient["auth"] & {
    getUser: () => Promise<{
      data: {
        user: {
          id: string;
          email?: string | null;
          app_metadata?: unknown;
          user_metadata?: unknown;
        } | null;
      };
      error: { message?: string } | null;
    }>;
  };
};

function deny(
  authenticated: boolean,
  reason: UnauthorizedActor["reason"]
): UnauthorizedActor {
  return { authenticated, authorized: false, reason };
}

/**
 * Resolve a trusted actor for privileged administration checks.
 * Fail-closed on every ambiguity. Does not log tokens or Auth user payloads.
 */
export async function getAuthenticatedActor(
  client: AuthActorClient | null
): Promise<AuthActor> {
  if (!client) {
    return deny(false, "missing_config");
  }

  const identity = await getAuthenticatedUser(client);
  if (!identity.authenticated) {
    if (identity.reason === "missing_config") {
      return deny(false, "missing_config");
    }
    if (identity.reason === "invalid_token") {
      return deny(false, "invalid_token");
    }
    return deny(false, "unauthenticated");
  }

  let userResult: Awaited<ReturnType<AuthActorClient["auth"]["getUser"]>>;
  try {
    userResult = await client.auth.getUser();
  } catch {
    return deny(true, "auth_server_error");
  }

  if (userResult.error || !userResult.data.user) {
    return deny(true, "auth_server_error");
  }

  const user = userResult.data.user;
  if (user.id !== identity.userId) {
    return deny(true, "user_mismatch");
  }

  // Explicitly ignore user-editable metadata for authorization.
  void user.user_metadata;

  if (user.app_metadata == null) {
    return deny(true, "missing_role");
  }

  const role = parseOperatorRole(user.app_metadata);
  if (!role) {
    // Distinguishes absent/empty vs present-but-invalid when useful for tests.
    const rawRole =
      typeof user.app_metadata === "object" &&
      user.app_metadata !== null &&
      !Array.isArray(user.app_metadata)
        ? (user.app_metadata as Record<string, unknown>).role
        : undefined;

    if (rawRole === undefined) {
      return deny(true, "missing_role");
    }
    return deny(true, "invalid_role");
  }

  const email =
    typeof user.email === "string" && user.email.length > 0
      ? user.email
      : identity.email;

  return {
    authenticated: true,
    authorized: true,
    userId: identity.userId,
    email,
    role,
  };
}

export function actorAllowsOperatorAccess(actor: AuthActor): boolean {
  return actor.authorized === true && roleAllowsOperatorAccess(actor.role);
}

export function actorAllowsAdminAccess(actor: AuthActor): boolean {
  return actor.authorized === true && roleAllowsAdminAccess(actor.role);
}
