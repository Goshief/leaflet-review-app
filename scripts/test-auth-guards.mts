import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_ACCESS_MATRIX,
  PAGE_ACCESS_MATRIX,
  PUBLIC_PAGE_PATHS,
  requiredApiAccess,
} from "../lib/auth/access-matrix.ts";
import {
  evaluateAccess,
  requireOperatorApi,
  requireAdminApi,
} from "../lib/auth/guards.ts";
import { getAuthenticatedActor } from "../lib/auth/actor.ts";
import { resolveSafeNextPath } from "../lib/auth/safe-next-path.ts";

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

function createMockClient(options: {
  claims?: Record<string, unknown> | null;
  claimsError?: { message: string } | null;
  user?: MockUser | null;
  getUserError?: { message: string } | null;
}) {
  return {
    auth: {
      async getClaims() {
        if (options.claimsError) return { data: null, error: options.claimsError };
        if (!options.claims) return { data: { claims: null }, error: null };
        return { data: { claims: options.claims }, error: null };
      },
      async getUser() {
        if (options.getUserError) {
          return { data: { user: null }, error: options.getUserError };
        }
        return { data: { user: options.user ?? null }, error: null };
      },
    },
  };
}

async function readError(response: Response) {
  const body = (await response.json()) as {
    ok: boolean;
    error: { code: string; message: string };
    request_id: string;
    detail?: string;
    stack?: string;
  };
  return body;
}

async function main() {
  const operatorClient = createMockClient({
    claims: { sub: "op1", email: "op@example.com" },
    user: { id: "op1", email: "op@example.com", app_metadata: { role: "operator" } },
  });
  const adminClient = createMockClient({
    claims: { sub: "ad1", email: "ad@example.com" },
    user: { id: "ad1", email: "ad@example.com", app_metadata: { role: "admin" } },
  });
  const noRoleClient = createMockClient({
    claims: { sub: "nr1", email: "nr@example.com" },
    user: {
      id: "nr1",
      email: "nr@example.com",
      app_metadata: {},
      user_metadata: { role: "admin" },
    },
  });
  const unauthClient = createMockClient({ claims: null });
  const spoofMetaClient = createMockClient({
    claims: { sub: "sm1" },
    user: {
      id: "sm1",
      app_metadata: { provider: "email" },
      user_metadata: { role: "admin" },
    },
  });
  const authErrorClient = createMockClient({
    claims: { sub: "ae1" },
    getUserError: { message: "auth upstream unavailable" },
  });

  // 1) API unauthenticated → 401
  {
    const gate = await requireOperatorApi({ client: unauthClient });
    assert.equal(gate.ok, false);
    if (!gate.ok) {
      assert.equal(gate.response.status, 401);
      const body = await readError(gate.response);
      assert.equal(body.error.code, "UNAUTHORIZED");
      assert.equal(gate.response.headers.get("Cache-Control")?.includes("no-store"), true);
    }
  }

  // 2) API authenticated without role → 403
  {
    const gate = await requireOperatorApi({ client: noRoleClient });
    assert.equal(gate.ok, false);
    if (!gate.ok) {
      assert.equal(gate.response.status, 403);
      const body = await readError(gate.response);
      assert.equal(body.error.code, "FORBIDDEN");
    }
  }

  // 3) operator on operator route → ok
  {
    const gate = await requireOperatorApi({ client: operatorClient });
    assert.equal(gate.ok, true);
    if (gate.ok) assert.equal(gate.actor.role, "operator");
  }

  // 4) admin on operator route → ok
  {
    const gate = await requireOperatorApi({ client: adminClient });
    assert.equal(gate.ok, true);
  }

  // 5) operator on admin route → 403
  {
    const gate = await requireAdminApi({ client: operatorClient });
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.response.status, 403);
  }

  // 6) admin on admin route → ok
  {
    const gate = await requireAdminApi({ client: adminClient });
    assert.equal(gate.ok, true);
    if (gate.ok) assert.equal(gate.actor.role, "admin");
  }

  // 7) Auth server error → fail-closed
  {
    const gate = await requireOperatorApi({ client: authErrorClient });
    assert.equal(gate.ok, false);
    if (!gate.ok) {
      assert.equal(gate.response.status, 403);
      const body = await readError(gate.response);
      assert.equal(body.error.message.includes("upstream"), false);
      assert.equal(body.error.message.includes("unavailable"), false);
    }
  }

  // 8) error response has no token / supabase detail
  {
    const gate = await requireOperatorApi({ client: unauthClient });
    if (!gate.ok) {
      const raw = JSON.stringify(await gate.response.clone().json());
      assert.equal(raw.includes("access_token"), false);
      assert.equal(raw.includes("refresh_token"), false);
      assert.equal(raw.includes("SERVICE_ROLE"), false);
      assert.equal("detail" in (await gate.response.clone().json()), false);
    }
  }

  // 9–12) page access evaluation (redirects are Next-runtime; use evaluateAccess)
  {
    const unauth = await getAuthenticatedActor(unauthClient);
    assert.equal(evaluateAccess(unauth, "operator").status, 401);

    const noRole = await getAuthenticatedActor(noRoleClient);
    assert.equal(evaluateAccess(noRole, "operator").status, 403);

    const op = await getAuthenticatedActor(operatorClient);
    assert.equal(evaluateAccess(op, "operator").status, 200);
    assert.equal(evaluateAccess(op, "admin").status, 403);

    const ad = await getAuthenticatedActor(adminClient);
    assert.equal(evaluateAccess(ad, "admin").status, 200);

    const next = resolveSafeNextPath("/batches");
    assert.equal(next, "/batches");
    assert.equal(resolveSafeNextPath("https://evil.example"), "/");
  }

  // 13) login / logout / forbidden are public (no operator required in matrix)
  {
    assert.ok(PUBLIC_PAGE_PATHS.includes("/login"));
    assert.ok(PUBLIC_PAGE_PATHS.includes("/logout"));
    assert.ok(PUBLIC_PAGE_PATHS.includes("/forbidden"));
    assert.equal(requiredApiAccess("app/logout/route.ts", "POST"), "public");
    const forbiddenPage = readSrc("app/forbidden/page.tsx");
    assert.equal(forbiddenPage.includes("requireAdminPage"), false);
    assert.equal(forbiddenPage.includes("requireOperatorPage"), false);
    const loginPage = readSrc("app/login/page.tsx");
    assert.equal(loginPage.includes("requireOperatorPage"), false);
  }

  // 14) Proxy keeps session-only contract (no role getUser authorization)
  {
    const proxyHelper = readSrc("lib/supabase/proxy.ts");
    assert.match(proxyHelper, /getClaims/);
    assert.equal(/getUser\s*\(/.test(proxyHelper), false);
    assert.match(proxyHelper, /Definitive operator\/admin authorization|requireOperatorApi/);
    assert.match(proxyHelper, /Cache-Control|SESSION_CACHE_HEADERS/);
  }

  // 15–16) guard before service-role / AI in representative handlers
  {
    const stats = readSrc("app/api/stats/route.ts");
    const getBody = stats.slice(stats.indexOf("export async function GET"));
    assert.ok(
      getBody.indexOf("requireOperatorApi") < getBody.indexOf("getSupabaseAdmin()"),
      "stats: guard before service-role"
    );

    const vision = readSrc("app/api/parse-lidl-page/route.ts");
    const postVision = vision.slice(vision.indexOf("export async function POST"));
    assert.ok(
      postVision.indexOf("requireOperatorApi") < postVision.indexOf("formData"),
      "vision: guard before form/AI work"
    );

    const ocr = readSrc("app/api/ocr-lidl-page/route.ts");
    const postOcr = ocr.slice(ocr.indexOf("export async function POST"));
    assert.ok(
      postOcr.indexOf("requireOperatorApi") < postOcr.indexOf("formData"),
      "ocr: guard before form"
    );
  }

  // 17) user_metadata.role=admin without app_metadata.role → 403
  {
    const gate = await requireOperatorApi({ client: spoofMetaClient });
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.response.status, 403);
  }

  // 18–20) matrix coverage + no unclassified sensitive API
  {
    for (const page of PAGE_ACCESS_MATRIX) {
      assert.ok(existsSync(join(root, page.guardModule)), `missing ${page.guardModule}`);
      const src = readSrc(page.guardModule);
      if (page.access === "admin") {
        assert.match(src, /requireAdminPage/);
        assert.match(src, /page-guards/);
      } else if (page.access === "operator") {
        assert.match(src, /requireOperatorPage/);
        assert.match(src, /page-guards/);
      }
    }

    for (const rule of API_ACCESS_MATRIX) {
      assert.ok(existsSync(join(root, rule.file)), `missing ${rule.file}`);
      const src = readSrc(rule.file);
      for (const [method, level] of Object.entries(rule.methods)) {
        if (level === "public") continue;
        const fn = `export async function ${method}`;
        assert.ok(src.includes(fn), `${rule.file} missing ${fn}`);
        if (level === "operator") {
          assert.match(src, /requireOperatorApi/);
        }
        if (level === "admin") {
          assert.match(src, /requireAdminApi/);
        }
      }
    }

    // Every app/api/**/route.ts must be classified
    function walkApi(dir: string, out: string[] = []): string[] {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) walkApi(p, out);
        else if (ent.name === "route.ts") {
          out.push(p.slice(root.length + 1).replace(/\\/g, "/"));
        }
      }
      return out;
    }
    const apiRoutes = walkApi(join(root, "app/api"));
    const classified = new Set(API_ACCESS_MATRIX.map((r) => r.file));
    // logout is under app/logout, not app/api
    for (const file of apiRoutes) {
      assert.ok(
        classified.has(file),
        `Unclassified API route (add to access-matrix): ${file}`
      );
    }

    // Public exception documented
    assert.equal(requiredApiAccess("app/api/setrik/offers/route.ts", "GET"), "public");
    assert.ok(PUBLIC_PAGE_PATHS.includes("/"));
    const setrik = readSrc("app/api/setrik/offers/route.ts");
    assert.equal(setrik.includes("requireOperatorApi"), false);
    assert.equal(setrik.includes("requireAdminApi"), false);
  }

  // Method split: parser-prompt GET operator, POST admin
  assert.equal(requiredApiAccess("app/api/parser-prompt/route.ts", "GET"), "operator");
  assert.equal(requiredApiAccess("app/api/parser-prompt/route.ts", "POST"), "admin");

  console.log("test-auth-guards: ok");
}

main().catch((err) => {
  console.error("test-auth-guards: failed");
  console.error(err);
  process.exit(1);
});
