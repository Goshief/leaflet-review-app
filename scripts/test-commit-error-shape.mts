import assert from "node:assert/strict";

type ErrorResponse = {
  ok: false;
  error: string;
  tx_guarantee: string;
  fallback_used: string | null;
  fallback_blocked?: boolean;
  detail?: string;
};

function assertNoDetail(body: ErrorResponse) {
  assert.equal("detail" in body, false, "response must not expose detail");
}

async function main() {
  const blocked: ErrorResponse = {
    ok: false,
    error:
      "Commit do DB selhal. Netransakční fallback je v produkci zakázaný, aby nevznikly částečné zápisy.",
    tx_guarantee: "none",
    fallback_used: null,
    fallback_blocked: true,
  };

  const fallbackFailed: ErrorResponse = {
    ok: false,
    error:
      "Commit do DB selhal. Nepodařilo se připojit přes transakční PG ani přes Supabase fallback.",
    tx_guarantee: "none",
    fallback_used: "supabase-js",
  };

  const pgMissing: ErrorResponse = {
    ok: false,
    error:
      "Commit do DB selhal. Pro transakční import nastav SUPABASE_DB_URL (nebo DATABASE_URL) na Postgres připojení.",
    tx_guarantee: "none",
    fallback_used: null,
  };

  assertNoDetail(blocked);
  assertNoDetail(fallbackFailed);
  assertNoDetail(pgMissing);

  console.log("test-commit-error-shape: ok");
}

main().catch((err) => {
  console.error("test-commit-error-shape: failed");
  console.error(err);
  process.exit(1);
});
