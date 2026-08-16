import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  consumeLoginRateLimit,
  getRequestAddress,
  hashLoginRateLimitKey,
  type LoginRateLimitClient,
} from "../lib/auth/login-rate-limit.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function rpcClient(handler: LoginRateLimitClient["rpc"]): LoginRateLimitClient {
  return { rpc: handler };
}

async function main() {
  assert.equal(
    getRequestAddress(new Headers({ "cf-connecting-ip": "203.0.113.7" })),
    "203.0.113.7"
  );
  assert.equal(
    getRequestAddress(new Headers({ "x-forwarded-for": "203.0.113.8, 10.0.0.1" })),
    "203.0.113.8"
  );

  const emailHash = await hashLoginRateLimitKey("email", " Operator@Example.Test ");
  assert.equal(emailHash.length, 64);
  assert.doesNotMatch(emailHash, /operator|example/i);
  assert.equal(emailHash, await hashLoginRateLimitKey("email", "operator@example.test"));

  const calls: Array<{ functionName: string; params: Record<string, unknown> }> = [];
  const allowed = await consumeLoginRateLimit(
    rpcClient(async (functionName, params) => {
      calls.push({ functionName, params: params ?? {} });
      return { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
    }),
    {
      email: "operator@example.test",
      headers: new Headers({ "cf-connecting-ip": "203.0.113.7" }),
    }
  );
  assert.equal(allowed.ok, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.functionName === "consume_login_rate_limit"));
  assert.ok(calls.every((call) => String(call.params.p_key_hash).length === 64));

  let call = 0;
  const blocked = await consumeLoginRateLimit(
    rpcClient(async () => {
      call += 1;
      return call === 1
        ? { data: [{ allowed: true, retry_after_seconds: 0 }], error: null }
        : { data: [{ allowed: false, retry_after_seconds: 37 }], error: null };
    }),
    { email: "operator@example.test", headers: new Headers() }
  );
  assert.deepEqual(blocked, { ok: false, code: "rate_limited", retryAfter: 37 });

  const unavailable = await consumeLoginRateLimit(
    rpcClient(async () => ({ data: null, error: { message: "offline" } })),
    { email: "operator@example.test", headers: new Headers() }
  );
  assert.deepEqual(unavailable, { ok: false, code: "unavailable" });

  const route = readFileSync(join(root, "app/api/auth/login/route.ts"), "utf8");
  const guardIndex = route.indexOf("requireSameOrigin(request)");
  const limiterIndex = route.indexOf("consumeLoginRateLimit(");
  const signInIndex = route.indexOf("signInWithPasswordFlow(");
  assert.ok(guardIndex >= 0 && limiterIndex > guardIndex);
  assert.ok(signInIndex > limiterIndex, "rate limit must run before password authentication");
  assert.match(route, /LOGIN_RATE_LIMIT_ERROR, 429/);
  assert.match(route, /LOGIN_UNAVAILABLE_ERROR, 503/);
  assert.match(route, /"Retry-After"/);
  assert.match(route, /loginJsonResponse/);
  const loginHttp = readFileSync(join(root, "lib/auth/login-http.ts"), "utf8");
  assert.match(loginHttp, /Cache-Control[\s\S]*no-store/);

  const actions = readFileSync(join(root, "app/login/actions.ts"), "utf8");
  assert.doesNotMatch(actions, /signInWithPassword|loginAction/);

  const migration = readFileSync(
    join(root, "supabase/migrations/20260816130000_login_rate_limit.sql"),
    "utf8"
  );
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.match(migration, /for update/i);

  console.log("test-login-rate-limit: ok");
}

main().catch((error) => {
  console.error("test-login-rate-limit: failed");
  console.error(error);
  process.exit(1);
});
