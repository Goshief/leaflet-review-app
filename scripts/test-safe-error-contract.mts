import assert from "node:assert/strict";
import { safeErrorJson } from "../lib/api/safe-error";

function readJson(response: Response) {
  return response.json() as Promise<{
    ok: boolean;
    error: { code: string; message: string };
    request_id: string;
    detail?: string;
    stack?: string;
  }>;
}

async function main() {
  const response = safeErrorJson({
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Interní chyba.",
    requestId: "req_test_123",
    cause: new Error("password authentication failed for user postgres"),
    logContext: { route: "/api/test" },
  });

  assert.equal(response.status, 500);

  const body = await readJson(response);

  assert.equal(body.ok, false);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.message, "Interní chyba.");
  assert.equal(body.request_id, "req_test_123");

  assert.equal("detail" in body, false);
  assert.equal("stack" in body, false);

  const serialized = JSON.stringify(body);
  assert.equal(
    serialized.includes("password authentication failed"),
    false,
    "response must not leak raw upstream/db message"
  );

  console.log("test-safe-error-contract: ok");
}

main().catch((err) => {
  console.error("test-safe-error-contract: failed");
  console.error(err);
  process.exit(1);
});
