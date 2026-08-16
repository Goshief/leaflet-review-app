import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { requireSameOrigin } from "../lib/auth/same-origin.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function request(headers: Record<string, string> = {}) {
  return new Request("https://admin.example.test/logout", {
    method: "POST",
    headers,
  });
}

async function main() {
  assert.deepEqual(
    requireSameOrigin(
      request({ origin: "https://admin.example.test", "sec-fetch-site": "same-origin" })
    ),
    { ok: true }
  );

  assert.deepEqual(
    requireSameOrigin(request({ origin: "https://admin.example.test" })),
    { ok: true }
  );

  assert.deepEqual(
    requireSameOrigin(request({ "sec-fetch-site": "same-origin" })),
    { ok: true }
  );

  assert.deepEqual(
    requireSameOrigin(
      request({ origin: "https://attacker.example", "sec-fetch-site": "cross-site" })
    ),
    { ok: false, reason: "cross_site" }
  );

  assert.deepEqual(
    requireSameOrigin(
      request({ origin: "https://admin.example.test", "sec-fetch-site": "same-site" })
    ),
    { ok: false, reason: "cross_site" }
  );

  assert.deepEqual(requireSameOrigin(request({ origin: "null" })), {
    ok: false,
    reason: "invalid_origin",
  });

  assert.deepEqual(requireSameOrigin(request()), {
    ok: false,
    reason: "missing_proof",
  });

  const route = readFileSync(join(root, "app/logout/route.ts"), "utf8");
  const guardIndex = route.indexOf("requireSameOrigin(request)");
  const clientIndex = route.indexOf("createClient()");
  assert.ok(guardIndex >= 0, "logout route must call the same-origin guard");
  assert.ok(clientIndex > guardIndex, "CSRF guard must run before the Auth client");
  assert.match(route, /export async function GET[\s\S]*status:\s*405/);
  assert.match(route, /Allow:\s*"POST"/);

  console.log("test-logout-csrf: ok");
}

main().catch((error) => {
  console.error("test-logout-csrf: failed");
  console.error(error);
  process.exit(1);
});
