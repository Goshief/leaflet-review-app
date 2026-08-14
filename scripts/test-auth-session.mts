import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getPublicSupabaseEnv } from "../lib/supabase/public-env.ts";
import { resolveSafeNextPath } from "../lib/auth/safe-next-path.ts";
import { getAuthenticatedUser } from "../lib/auth/identity.ts";
import {
  signInWithPasswordFlow,
  GENERIC_LOGIN_ERROR,
} from "../lib/auth/login.ts";
import { signOutFlow } from "../lib/auth/logout.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function createMockAuthClient(options: {
  claims?: Record<string, unknown> | null;
  claimsError?: { message: string } | null;
  signIn?: {
    session: Record<string, unknown> | null;
    user: { id: string } | null;
    error: { message: string } | null;
  };
  signOutError?: Error | null;
  getSessionUser?: { id: string; user_metadata?: Record<string, unknown> } | null;
  trackGetSession?: { called: boolean };
}) {
  const track = options.trackGetSession ?? { called: false };

  return {
    auth: {
      async getClaims() {
        if (options.claimsError) {
          return { data: null, error: options.claimsError };
        }
        if (!options.claims) {
          return { data: { claims: null }, error: null };
        }
        return { data: { claims: options.claims }, error: null };
      },
      async getSession() {
        track.called = true;
        return {
          data: {
            session: options.getSessionUser
              ? { user: options.getSessionUser }
              : null,
          },
          error: null,
        };
      },
      async signInWithPassword() {
        const result = options.signIn ?? {
          session: null,
          user: null,
          error: { message: "Invalid login credentials" },
        };
        return { data: { session: result.session, user: result.user }, error: result.error };
      },
      async signOut() {
        if (options.signOutError) {
          throw options.signOutError;
        }
        return { error: null };
      },
    },
    __trackGetSession: track,
  };
}

async function main() {
  // 1) Missing Auth configuration
  {
    const env = getPublicSupabaseEnv({});
    assert.equal(env, null);

    const identity = await getAuthenticatedUser(null);
    assert.deepEqual(identity, { authenticated: false, reason: "missing_config" });

    const login = await signInWithPasswordFlow(null, {
      email: "operator@example.com",
      password: "not-a-real-secret",
    });
    assert.equal(login.ok, false);
    if (!login.ok) {
      assert.equal(login.code, "missing_config");
      assert.equal(login.error, GENERIC_LOGIN_ERROR);
    }
  }

  // 2) Valid internal next redirect
  assert.equal(resolveSafeNextPath("/batches"), "/batches");
  assert.equal(resolveSafeNextPath("/batches?tab=open"), "/batches?tab=open");

  // 3) Rejected external / open redirects
  assert.equal(resolveSafeNextPath("https://attacker.example"), "/");
  assert.equal(resolveSafeNextPath("//attacker.example"), "/");
  assert.equal(resolveSafeNextPath("https://attacker.example/phish"), "/");
  assert.equal(resolveSafeNextPath("\\\\attacker.example"), "/");
  assert.equal(resolveSafeNextPath("/\\evil"), "/");

  // 4) Invalid credentials → generic error (no account enumeration)
  {
    const client = createMockAuthClient({
      signIn: {
        session: null,
        user: null,
        error: { message: "Invalid login credentials" },
      },
    });
    const result = await signInWithPasswordFlow(client, {
      email: "nobody@example.com",
      password: "wrong-password-value",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "invalid_credentials");
      assert.equal(result.error, GENERIC_LOGIN_ERROR);
      assert.equal(result.error.includes("nobody@example.com"), false);
    }
  }

  // 5) Successful login establishes session (cookies via SSR client — marked for tests)
  {
    const client = createMockAuthClient({
      signIn: {
        session: {
          access_token: "test-access-token-placeholder",
          refresh_token: "test-refresh-token-placeholder",
        },
        user: { id: "user_test_1" },
        error: null,
      },
    });
    const result = await signInWithPasswordFlow(client, {
      email: "operator@example.com",
      password: "correct-horse-test-only",
      next: "/batches",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.sessionEstablished, true);
      assert.equal(result.redirectTo, "/batches");
    }
  }

  // 6) Logout success
  {
    const client = createMockAuthClient({});
    const result = await signOutFlow(client);
    assert.deepEqual(result, { ok: true, redirectTo: "/login" });
  }

  // 7) Repeated logout must not throw
  {
    const first = await signOutFlow(createMockAuthClient({}));
    const second = await signOutFlow(
      createMockAuthClient({ signOutError: new Error("session missing") })
    );
    const third = await signOutFlow(null);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(third.ok, true);
  }

  // 8) Unauthenticated identity
  {
    const client = createMockAuthClient({ claims: null });
    const identity = await getAuthenticatedUser(client);
    assert.deepEqual(identity, { authenticated: false, reason: "no_session" });
  }

  // 9) Valid verified identity via getClaims
  {
    const client = createMockAuthClient({
      claims: {
        sub: "user_verified_9",
        email: "operator@example.com",
        user_metadata: { role: "admin" },
      },
    });
    const identity = await getAuthenticatedUser(client);
    assert.equal(identity.authenticated, true);
    if (identity.authenticated) {
      assert.equal(identity.userId, "user_verified_9");
      assert.equal(identity.email, "operator@example.com");
      assert.equal("role" in identity, false);
      assert.equal("user_metadata" in identity, false);
    }
  }

  // 10) Spoofed / invalid token rejected
  {
    const client = createMockAuthClient({
      claimsError: { message: "invalid JWT" },
      getSessionUser: {
        id: "spoofed-user",
        user_metadata: { role: "admin" },
      },
    });
    const identity = await getAuthenticatedUser(client);
    assert.deepEqual(identity, { authenticated: false, reason: "invalid_token" });
  }

  // 11) Server must not use getSession() as authorization proof
  {
    const track = { called: false };
    const client = createMockAuthClient({
      claims: { sub: "user_11", email: "a@example.com" },
      getSessionUser: { id: "session-should-be-ignored", user_metadata: { role: "admin" } },
      trackGetSession: track,
    });
    await getAuthenticatedUser(client);
    assert.equal(track.called, false, "getAuthenticatedUser must not call getSession()");

    const identitySource = readSrc("lib/auth/identity.ts");
    assert.match(identitySource, /getClaims/);
    assert.equal(
      /getSession\s*\(/.test(identitySource),
      false,
      "identity helper must not call getSession"
    );
    assert.match(
      identitySource,
      /unverified session user|cookie storage alone|authorization proof/i
    );

    const proxySource = readSrc("lib/supabase/proxy.ts");
    assert.match(proxySource, /getClaims/);
    assert.equal(/getSession\s*\(/.test(proxySource), false);
  }

  // 12) Browser Auth client must not import service-role env
  {
    const browserClient = readSrc("lib/supabase/client.ts");
    assert.match(browserClient, /createBrowserClient/);
    assert.equal(
      /process\.env\.SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/.test(browserClient),
      false
    );
    assert.equal(browserClient.includes("getSupabaseAdmin"), false);

    const publicEnv = readSrc("lib/supabase/public-env.ts");
    assert.equal(
      /process\.env\.SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/.test(publicEnv),
      false
    );
    assert.match(publicEnv, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    assert.match(publicEnv, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  }

  // 13) user_metadata grants no permission on identity contract
  {
    const client = createMockAuthClient({
      claims: {
        sub: "user_13",
        email: "meta@example.com",
        user_metadata: { role: "admin", is_admin: true, permissions: ["*"] },
        app_metadata: { role: "admin" },
      },
    });
    const identity = await getAuthenticatedUser(client);
    assert.equal(identity.authenticated, true);
    if (identity.authenticated) {
      const serialized = JSON.stringify(identity);
      assert.equal(serialized.includes("admin"), false);
      assert.equal(serialized.includes("permissions"), false);
      assert.equal(serialized.includes("user_metadata"), false);
    }
  }

  // Publishable + anon fallback resolution
  {
    const withPublishable = getPublicSupabaseEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon_ignored_when_publishable_set",
    });
    assert.deepEqual(withPublishable, {
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_test",
    });

    const withAnonFallback = getPublicSupabaseEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon_fallback_test",
    });
    assert.deepEqual(withAnonFallback, {
      url: "https://example.supabase.co",
      publishableKey: "anon_fallback_test",
    });
  }

  console.log("test-auth-session: ok");
}

main().catch((err) => {
  console.error("test-auth-session: failed");
  console.error(err);
  process.exit(1);
});
