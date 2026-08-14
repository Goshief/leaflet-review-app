import type { AuthClaimsClient } from "./identity.ts";
import { resolveSafeNextPath, DEFAULT_POST_LOGIN_PATH } from "./safe-next-path.ts";

export const GENERIC_LOGIN_ERROR = "Přihlášení se nezdařilo. Zkontrolujte údaje a zkuste to znovu.";

export type PasswordAuthClient = AuthClaimsClient & {
  auth: AuthClaimsClient["auth"] & {
    signInWithPassword: (credentials: {
      email: string;
      password: string;
    }) => Promise<{
      data: {
        session: {
          access_token?: string;
          refresh_token?: string;
          expires_at?: number;
        } | null;
        user: { id: string } | null;
      };
      error: { message?: string } | null;
    }>;
  };
};

export type LoginSuccess = {
  ok: true;
  redirectTo: string;
  /** Opaque marker for tests — never expose token values. */
  sessionEstablished: true;
};

export type LoginFailure = {
  ok: false;
  error: string;
  code: "missing_config" | "invalid_credentials" | "invalid_input";
};

export type LoginResult = LoginSuccess | LoginFailure;

export type LoginInput = {
  email: unknown;
  password: unknown;
  next?: unknown;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Password login against Supabase Auth. Uses a generic error for all failures
 * so responses do not reveal whether an account exists.
 */
export async function signInWithPasswordFlow(
  client: PasswordAuthClient | null,
  input: LoginInput
): Promise<LoginResult> {
  if (!client) {
    return { ok: false, error: GENERIC_LOGIN_ERROR, code: "missing_config" };
  }

  const email = asNonEmptyString(input.email);
  const password = typeof input.password === "string" ? input.password : null;

  if (!email || password == null || password.length === 0) {
    return { ok: false, error: GENERIC_LOGIN_ERROR, code: "invalid_input" };
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    return { ok: false, error: GENERIC_LOGIN_ERROR, code: "invalid_credentials" };
  }

  return {
    ok: true,
    redirectTo: resolveSafeNextPath(input.next, DEFAULT_POST_LOGIN_PATH),
    sessionEstablished: true,
  };
}
