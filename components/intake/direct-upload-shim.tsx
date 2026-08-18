"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect } from "react";

type IntakeSetup = {
  ok?: boolean;
  error?: string;
  intake_id?: string;
  original_name?: string | null;
  mime?: string;
  upload_bucket?: string;
  upload_path?: string;
  upload_token?: string;
};

/**
 * Compatibility bridge for the existing UploadForm.
 * It intercepts only its legacy multipart POST /api/intake call, asks the
 * server for a short-lived signed Storage upload token, uploads the File
 * directly browser -> Supabase Storage, then returns the same JSON shape the
 * old form expects. This avoids Vercel request-body limits for large PDFs.
 */
export function DirectIntakeUploadShim() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const body = init?.body;
      const isIntake = (() => {
        try {
          return new URL(url, window.location.origin).pathname === "/api/intake";
        } catch {
          return false;
        }
      })();

      if (!isIntake || method !== "POST" || !(body instanceof FormData)) {
        return originalFetch(input, init);
      }

      const candidate = body.get("file");
      if (!(candidate instanceof File)) {
        return new Response(JSON.stringify({ ok: false, error: "Chybí soubor pro upload." }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const setupRes = await originalFetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: candidate.name,
          mime: candidate.type || "application/octet-stream",
          size: candidate.size,
        }),
      });
      const setupText = await setupRes.text();

      let setup: IntakeSetup;
      try {
        setup = JSON.parse(setupText) as IntakeSetup;
      } catch {
        return new Response(
          JSON.stringify({ ok: false, error: `Server vrátil neplatnou odpověď (HTTP ${setupRes.status}).` }),
          { status: setupRes.status || 502, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        !setupRes.ok ||
        setup.ok !== true ||
        !setup.upload_bucket ||
        !setup.upload_path ||
        !setup.upload_token
      ) {
        return new Response(setupText, {
          status: setupRes.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      const supabase = createClient();
      const { error } = await supabase.storage
        .from(setup.upload_bucket)
        .uploadToSignedUrl(setup.upload_path, setup.upload_token, candidate, {
          contentType: candidate.type || undefined,
          upsert: false,
        });

      if (error) {
        return new Response(
          JSON.stringify({ ok: false, error: `Upload do Supabase Storage selhal: ${error.message}` }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(setupText, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
