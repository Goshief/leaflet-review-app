export type SignOutAuthClient = {
  auth: {
    signOut: () => Promise<{ error: { message?: string } | null }>;
  };
};

export type LogoutResult = {
  ok: true;
  redirectTo: "/login";
};

/**
 * Sign out via Supabase Auth. Idempotent: a missing/expired session is still success.
 * Must not use the service-role key.
 */
export async function signOutFlow(client: SignOutAuthClient | null): Promise<LogoutResult> {
  if (client) {
    try {
      await client.auth.signOut();
    } catch {
      // Repeated logout / already cleared session must not fail the request.
    }
  }

  return { ok: true, redirectTo: "/login" };
}
