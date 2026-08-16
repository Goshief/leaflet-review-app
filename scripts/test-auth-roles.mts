import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getAuthenticatedActor,
  actorAllowsAdminAccess,
  actorAllowsOperatorAccess,
} from "../lib/auth/actor.ts";
import {
  isOperatorRole,
  parseOperatorRole,
  roleAllowsAdminAccess,
  roleAllowsOperatorAccess,
} from "../lib/auth/roles.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

type MockUser = {
  id: string;
  email?: string | null;
  app_metadata?: unknown;
  user_metadata?: unknown;
};

function createMockActorClient(options: {
  claims?: Record<string, unknown> | null;
  claimsError?: { message: string } | null;
  user?: MockUser | null;
  getUserError?: { message: string } | null;
  getUserThrows?: Error | null;
  trackGetSession?: { called: boolean };
  trackGetUser?: { called: boolean };
}) {
  const trackSession = options.trackGetSession ?? { called: false };
  const trackUser = options.trackGetUser ?? { called: false };

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
      async getUser() {
        trackUser.called = true;
        if (options.getUserThrows) {
          throw options.getUserThrows;
        }
        if (options.getUserError) {
          return { data: { user: null }, error: options.getUserError };
        }
        return { data: { user: options.user ?? null }, error: null };
      },
      async getSession() {
        trackSession.called = true;
        return {
          data: {
            session: {
              access_token: "must-not-be-used",
              refresh_token: "must-not-be-used",
              user: {
                id: "session-user",
                user_metadata: { role: "admin" },
                app_metadata: { role: "admin" },
              },
            },
          },
          error: null,
        };
      },
    },
    __trackGetSession: trackSession,
    __trackGetUser: trackUser,
  };
}

async function main() {
  // Pure role helpers
  assert.equal(isOperatorRole("operator"), true);
  assert.equal(isOperatorRole("admin"), true);
  assert.equal(isOperatorRole("Admin"), false);
  assert.equal(isOperatorRole("OPERATOR"), false);
  assert.equal(roleAllowsOperatorAccess("operator"), true);
  assert.equal(roleAllowsOperatorAccess("admin"), true);
  assert.equal(roleAllowsAdminAccess("operator"), false);
  assert.equal(roleAllowsAdminAccess("admin"), true);

  // 1) operator → operator yes, admin no
  {
    const client = createMockActorClient({
      claims: { sub: "u1", email: "op@example.com", app_metadata: { role: "admin" } },
      user: {
        id: "u1",
        email: "op@example.com",
        app_metadata: { role: "operator" },
        user_metadata: { role: "admin" },
      },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, true);
    if (actor.authorized) {
      assert.equal(actor.role, "operator");
      assert.equal(actorAllowsOperatorAccess(actor), true);
      assert.equal(actorAllowsAdminAccess(actor), false);
    }
  }

  // 2) admin → both yes
  {
    const client = createMockActorClient({
      claims: { sub: "u2", email: "adm@example.com" },
      user: {
        id: "u2",
        email: "adm@example.com",
        app_metadata: { role: "admin" },
      },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, true);
    if (actor.authorized) {
      assert.equal(actor.role, "admin");
      assert.equal(actorAllowsOperatorAccess(actor), true);
      assert.equal(actorAllowsAdminAccess(actor), true);
    }
  }

  // 3) authenticated without role → deny
  {
    const client = createMockActorClient({
      claims: { sub: "u3", email: "norole@example.com" },
      user: {
        id: "u3",
        email: "norole@example.com",
        app_metadata: { provider: "email" },
      },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, false);
    if (!actor.authorized) {
      assert.equal(actor.reason, "missing_role");
      assert.equal(actor.authenticated, true);
    }
  }

  // 4) only user_metadata.role = admin → deny
  {
    const client = createMockActorClient({
      claims: { sub: "u4", email: "meta@example.com" },
      user: {
        id: "u4",
        email: "meta@example.com",
        app_metadata: {},
        user_metadata: { role: "admin" },
      },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, false);
    if (!actor.authorized) {
      assert.equal(actor.reason, "missing_role");
    }
    assert.equal(parseOperatorRole({}), null);
    assert.equal(parseOperatorRole(undefined), null);
  }

  // 5) viewer → deny
  {
    const client = createMockActorClient({
      claims: { sub: "u5" },
      user: { id: "u5", app_metadata: { role: "viewer" } },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, false);
    if (!actor.authorized) assert.equal(actor.reason, "invalid_role");
  }

  // 6) empty role → deny
  {
    const client = createMockActorClient({
      claims: { sub: "u6" },
      user: { id: "u6", app_metadata: { role: "" } },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, false);
    if (!actor.authorized) assert.equal(actor.reason, "invalid_role");
  }

  // 7) null role → deny
  {
    const client = createMockActorClient({
      claims: { sub: "u7" },
      user: { id: "u7", app_metadata: { role: null } },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, false);
    if (!actor.authorized) assert.equal(actor.reason, "invalid_role");
  }

  // 8) array role → deny (string-only contract)
  {
    assert.equal(parseOperatorRole({ role: ["admin"] }), null);
    const client = createMockActorClient({
      claims: { sub: "u8" },
      user: { id: "u8", app_metadata: { role: ["admin"] } },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, false);
    if (!actor.authorized) assert.equal(actor.reason, "invalid_role");
  }

  // 9) typo / wrong casing → deny
  {
    assert.equal(parseOperatorRole({ role: "Admin" }), null);
    assert.equal(parseOperatorRole({ role: "operater" }), null);
    const client = createMockActorClient({
      claims: { sub: "u9" },
      user: { id: "u9", app_metadata: { role: "Admin" } },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, false);
    if (!actor.authorized) assert.equal(actor.reason, "invalid_role");
  }

  // 10) unauthenticated → deny
  {
    const client = createMockActorClient({ claims: null });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, false);
    if (!actor.authorized) {
      assert.equal(actor.authenticated, false);
      assert.equal(actor.reason, "unauthenticated");
    }
  }

  // 11) getUser() error → deny
  {
    const client = createMockActorClient({
      claims: { sub: "u11", email: "x@example.com" },
      getUserError: { message: "network timeout" },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, false);
    if (!actor.authorized) {
      assert.equal(actor.authenticated, true);
      assert.equal(actor.reason, "auth_server_error");
    }

    const throwing = createMockActorClient({
      claims: { sub: "u11b" },
      getUserThrows: new Error("upstream down"),
    });
    const actor2 = await getAuthenticatedActor(throwing);
    assert.equal(actor2.authorized, false);
    if (!actor2.authorized) assert.equal(actor2.reason, "auth_server_error");
  }

  // 12) claims vs Auth user ID mismatch → deny
  {
    const client = createMockActorClient({
      claims: { sub: "claims-id" },
      user: { id: "other-id", app_metadata: { role: "admin" } },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, false);
    if (!actor.authorized) assert.equal(actor.reason, "user_mismatch");
  }

  // 13) invalid / spoofed token → deny
  {
    const client = createMockActorClient({
      claimsError: { message: "invalid JWT" },
      user: { id: "spoof", app_metadata: { role: "admin" } },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, false);
    if (!actor.authorized) {
      assert.equal(actor.authenticated, false);
      assert.equal(actor.reason, "invalid_token");
    }
  }

  // 14) stale claims admin, fresh getUser operator → operator
  {
    const client = createMockActorClient({
      claims: {
        sub: "u14",
        app_metadata: { role: "admin" },
      },
      user: {
        id: "u14",
        app_metadata: { role: "operator" },
      },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, true);
    if (actor.authorized) {
      assert.equal(actor.role, "operator");
      assert.equal(actorAllowsAdminAccess(actor), false);
    }
  }

  // 15) stale claims admin, fresh user has no role → deny
  {
    const client = createMockActorClient({
      claims: {
        sub: "u15",
        app_metadata: { role: "admin" },
      },
      user: {
        id: "u15",
        app_metadata: { provider: "email" },
        user_metadata: { role: "admin" },
      },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, false);
    if (!actor.authorized) assert.equal(actor.reason, "missing_role");
  }

  // 16) getSession must not be used as authorization proof
  {
    const track = { called: false };
    const client = createMockActorClient({
      claims: { sub: "u16" },
      user: { id: "u16", app_metadata: { role: "operator" } },
      trackGetSession: track,
    });
    await getAuthenticatedActor(client);
    assert.equal(track.called, false);

    const actorSrc = readSrc("lib/auth/actor.ts");
    const rolesSrc = readSrc("lib/auth/roles.ts");
    assert.match(actorSrc, /getUser/);
    assert.match(actorSrc, /app_metadata/);
    assert.equal(/getSession\s*\(/.test(actorSrc), false);
    assert.equal(/getSession\s*\(/.test(rolesSrc), false);
  }

  // 17) service-role key must not be used
  {
    const actorSrc = readSrc("lib/auth/actor.ts");
    const rolesSrc = readSrc("lib/auth/roles.ts");
    assert.equal(
      /SERVICE_ROLE_KEY|service_role|getSupabaseAdmin/.test(actorSrc + rolesSrc),
      false
    );
  }

  // 18) serialized actor has no tokens / raw metadata
  {
    const client = createMockActorClient({
      claims: { sub: "u18", email: "safe@example.com" },
      user: {
        id: "u18",
        email: "safe@example.com",
        app_metadata: { role: "admin", provider: "email" },
        user_metadata: { role: "admin", full_name: "Secret" },
      },
    });
    const actor = await getAuthenticatedActor(client);
    assert.equal(actor.authorized, true);
    const serialized = JSON.stringify(actor);
    assert.equal(serialized.includes("access_token"), false);
    assert.equal(serialized.includes("refresh_token"), false);
    assert.equal(serialized.includes("user_metadata"), false);
    assert.equal(serialized.includes("app_metadata"), false);
    assert.equal(serialized.includes("full_name"), false);
    assert.equal(serialized.includes("Secret"), false);
    if (actor.authorized) {
      assert.deepEqual(Object.keys(actor).sort(), [
        "authenticated",
        "authorized",
        "email",
        "role",
        "userId",
      ]);
    }
  }

  // Missing config / null app_metadata
  {
    const missing = await getAuthenticatedActor(null);
    assert.deepEqual(missing, {
      authenticated: false,
      authorized: false,
      reason: "missing_config",
    });

    const nullMeta = createMockActorClient({
      claims: { sub: "uN" },
      user: { id: "uN", app_metadata: null },
    });
    const actor = await getAuthenticatedActor(nullMeta);
    assert.equal(actor.authorized, false);
    if (!actor.authorized) assert.equal(actor.reason, "missing_role");
  }

  console.log("test-auth-roles: ok");
}

main().catch((err) => {
  console.error("test-auth-roles: failed");
  console.error(err);
  process.exit(1);
});
