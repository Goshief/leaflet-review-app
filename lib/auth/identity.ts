/**
 * Server-side identity verification.
 *
 * Trusts JWT validation via getClaims() — never the session user object from
 * cookie storage alone. Roles may be read only from the cryptographically
 * verified app_metadata claim, never from user_metadata.
 */

export type AuthenticatedIdentity = {
  authenticated: true;
  userId: string;
  email: string | null;
  appMetadata: unknown;
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

  // user_metadata is user-editable and must never grant privileges.
  void claims.user_metadata;

  return {
    authenticated: true,
    userId,
    email: readStringClaim(claims, "email"),
    appMetadata: claims.app_metadata ?? null,
  };
}
