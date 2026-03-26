import assert from "node:assert/strict";

const adminModulePath = "../lib/supabase/admin.ts";

async function loadFresh() {
  const mod = await import(`${adminModulePath}?t=${Date.now()}_${Math.random()}`);
  return mod as { getSupabaseAdmin: () => unknown | null };
}

async function main() {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const m1 = await loadFresh();
    assert.equal(m1.getSupabaseAdmin(), null, "without env client must be null");

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

    const m2 = await loadFresh();
    const client = m2.getSupabaseAdmin();
    assert.ok(client, "with env client must initialize (configured:true path)");

    console.log("test-dashboard-configured-env: ok");
  } finally {
    if (prevUrl == null) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
}

main().catch((err) => {
  console.error("test-dashboard-configured-env: failed");
  console.error(err);
  process.exit(1);
});
