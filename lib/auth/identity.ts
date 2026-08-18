/**
 * Server-side identity verification.
 *
 * Trusts JWT validation via getClaims() — never the session user object from
 * cookie storage alone. Does not grant admin/operator roles (see `actor.ts` /
 * `roles.ts`) and ignores user_metadata for authorization.
 */

export type AuthenticatedIdentity = {
  authenticated: true;
  userId: string;
  email: string | null;
};

export type UnauthenticatedIdentity = {
  authenticated: false;
  reason: "missing_config" | "no_session" | "invalid_token";
};

export type AuthIdentity = AuthenticatedIdentity | UnauthenticatedIdentity;

export type AuthClaimsClient = {
  auth: {
    getClaims: () => Promise<{
      data: { claims?: Record<string, unknown> | null } | null;
      error: { message?: string } | null;
    }>;
  };
};

const AUTH_CHECK_TIMEOUT_MS = 5000;

async function withAuthTimeout<T>(promise: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), AUTH_CHECK_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readStringClaim(claims: Record<string, unknown>, key: string): string | null {
  const value = claims[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Verify the caller identity from a validated access token.
 * Does not read roles from user_metadata and does not treat an unverified
 * session user object as authorization proof.
 */
export async function getAuthenticatedUser(
  client: AuthClaimsClient | null
): Promise<AuthIdentity> {
  if (!client) {
    return { authenticated: false, reason: "missing_config" };
  }

  const result = await withAuthTimeout(client.auth.getClaims());
  if (!result) {
    return { authenticated: false, reason: "invalid_token" };
  }

  const { data, error } = result;

  if (error || !data?.claims) {
    return { authenticated: false, reason: error ? "invalid_token" : "no_session" };
  }

  const claims = data.claims;
  const userId = readStringClaim(claims, "sub");
  if (!userId) {
    return { authenticated: false, reason: "invalid_token" };
  }

  void claims.user_metadata;

  return {
    authenticated: true,
    userId,
    email: readStringClaim(claims, "email"),
  };
}
