import assert from "node:assert/strict";

type ErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  request_id: string;
  detail?: string;
};

async function main() {
  const body: ErrorBody = {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Nepodařilo se načíst statistiky.",
    },
    request_id: "req_test_stats_1",
  };

  assert.equal(body.ok, false);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(typeof body.error.message, "string");
  assert.equal(typeof body.request_id, "string");
  assert.equal("detail" in body, false, "stats error response must not expose detail");

  console.log("test-stats-error-shape: ok");
}

main().catch((err) => {
  console.error("test-stats-error-shape: failed");
  console.error(err);
  process.exit(1);
});
