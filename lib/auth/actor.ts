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

const AUTH_USER_TIMEOUT_MS = 5000;

function deny(
  authenticated: boolean,
  reason: UnauthorizedActor["reason"]
): UnauthorizedActor {
  return { authenticated, authorized: false, reason };
}

async function getUserWithTimeout(client: AuthActorClient) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client.auth.getUser(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), AUTH_USER_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

  const userResult = await getUserWithTimeout(client);
  if (!userResult || userResult.error || !userResult.data.user) {
    return deny(true, "auth_server_error");
  }

  const user = userResult.data.user;
  if (user.id !== identity.userId) return deny(true, "user_mismatch");

  void user.user_metadata;

  if (user.app_metadata == null) return deny(true, "missing_role");

  const role = parseOperatorRole(user.app_metadata);
  if (!role) {
    const rawRole =
      typeof user.app_metadata === "object" &&
      user.app_metadata !== null &&
      !Array.isArray(user.app_metadata)
        ? (user.app_metadata as Record<string, unknown>).role
        : undefined;
    return deny(true, rawRole === undefined ? "missing_role" : "invalid_role");
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
