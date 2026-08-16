import assert from "node:assert/strict";
import { readIntakeUploadResult } from "../lib/intake/upload-result.ts";

async function main() {
  const success = await readIntakeUploadResult(
    Response.json({
      ok: true,
      intake_id: "intake-1",
      original_name: "letak.png",
      mime: "image/png",
    })
  );
  assert.deepEqual(success, {
    ok: true,
    intake_id: "intake-1",
    original_name: "letak.png",
    mime: "image/png",
  });

  const apiError = await readIntakeUploadResult(
    Response.json(
      { ok: false, error: "Soubor je příliš velký." },
      { status: 400 }
    )
  );
  assert.deepEqual(apiError, {
    ok: false,
    error: "Soubor je příliš velký.",
  });

  const safeApiError = await readIntakeUploadResult(
    Response.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Upload se nepodařilo uložit." },
        request_id: "req-1",
      },
      { status: 500 }
    )
  );
  assert.deepEqual(safeApiError, {
    ok: false,
    error: "Upload se nepodařilo uložit.",
  });

  const vercelLogin = await readIntakeUploadResult(
    new Response("<html><title>Log in to Vercel</title>Continue with Email</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    })
  );
  assert.deepEqual(vercelLogin, {
    ok: false,
    error: "Přihlášení ke stagingu vypršelo. Obnov stránku a přihlas se znovu.",
  });

  const invalidResponse = await readIntakeUploadResult(
    new Response("Bad Gateway", { status: 502 })
  );
  assert.deepEqual(invalidResponse, {
    ok: false,
    error: "Server vrátil neplatnou odpověď (HTTP 502).",
  });

  console.log("test-intake-upload-result: ok");
}

main().catch((error) => {
  console.error("test-intake-upload-result: failed");
  console.error(error);
  process.exit(1);
});
