import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NextResponse } from "next/server.js";

import { requireOperatorApi } from "../lib/auth/guards.ts";
import { loginJsonResponse } from "../lib/auth/login-http.ts";
import {
  applySecurityHeaders,
  SECURITY_HEADERS,
} from "../lib/security/headers.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function assertSecurityHeaders(response: Response) {
  for (const { key, value } of SECURITY_HEADERS) {
    assert.equal(response.headers.get(key), value, `${key} must use the central value`);
  }
}

async function main() {
  const csp = SECURITY_HEADERS.find(({ key }) => key === "Content-Security-Policy")?.value;
  assert.ok(csp);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /script-src|style-src|unsafe-eval/);

  const redirect = applySecurityHeaders(
    NextResponse.redirect("https://admin.example.test/login", 303)
  );
  assert.equal(redirect.status, 303);
  assertSecurityHeaders(redirect);

  const unauthenticated = await requireOperatorApi({ client: null });
  assert.equal(unauthenticated.ok, false);
  if (!unauthenticated.ok) {
    assert.equal(unauthenticated.response.status, 401);
    assertSecurityHeaders(unauthenticated.response);
  }

  const noRoleClient = {
    auth: {
      async getClaims() {
        return { data: { claims: { sub: "user-1" } }, error: null };
      },
      async getUser() {
        return {
          data: { user: { id: "user-1", app_metadata: {}, user_metadata: {} } },
          error: null,
        };
      },
    },
  };
  const forbidden = await requireOperatorApi({ client: noRoleClient });
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) {
    assert.equal(forbidden.response.status, 403);
    assertSecurityHeaders(forbidden.response);
  }

  const rateLimited = loginJsonResponse(
    { ok: false, error: "rate limited" },
    429,
    { "Retry-After": "60" }
  );
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get("Retry-After"), "60");
  assertSecurityHeaders(rateLimited);

  const unavailable = loginJsonResponse({ ok: false, error: "unavailable" }, 503);
  assert.equal(unavailable.status, 503);
  assertSecurityHeaders(unavailable);

  const config = readSrc("next.config.ts");
  assert.match(config, /source:\s*"\/\(\.\*\)"/);
  assert.match(config, /SECURITY_HEADERS\.map/);

  const proxy = readSrc("lib/supabase/proxy.ts");
  assert.match(proxy, /applySecurityHeaders\(NextResponse\.next/);

  const logout = readSrc("app/logout/route.ts");
  assert.match(logout, /applySecurityHeaders\(response\)/);
  assert.match(logout, /applySecurityHeaders\(NextResponse\.json/);

  console.log("test-security-headers: ok");
}

main().catch((error) => {
  console.error("test-security-headers: failed");
  console.error(error);
  process.exit(1);
});
