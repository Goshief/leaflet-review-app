import { NextRequest, NextResponse } from "next/server";
import { parseLidlPageOffersJson } from "@/lib/lidl-parser";
import { withPgClient } from "@/lib/db/pg";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { canUseNonTransactionalFallback } from "@/lib/commit/fallback-policy";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";
import {
  bulkInsertOffersQuarantine,
  bulkInsertOffersRaw,
  createImportRun,
} from "@/lib/import-run/import-run";
import { mapOffersForImportRun, type RowStatus } from "@/lib/import-run/map-offers";

export const runtime = "nodejs";
export const maxDuration = 120;

type CommitRequest = {
  page_no?: number | null;
  retailer?: string | null;
  source_url?: string | null;
  original_filename?: string | null;
  actor?: string | null;
  offers: unknown[];
  row_status?: Record<number, "pending" | "approved" | "rejected" | "quarantine">;
};

export async function POST(req: NextRequest) {
  const requestId = makeRequestId();
  let body: CommitRequest;
  try {
    body = (await req.json()) as CommitRequest;
  } catch {
    return safeErrorJson({
      status: 400,
      code: "BAD_REQUEST",
      message: "Očekávám JSON body.",
      requestId,
    });
  }
  if (!Array.isArray(body.offers)) {
    return safeErrorJson({
      status: 400,
      code: "BAD_REQUEST",
      message: "Pole offers musí být validní pole.",
      requestId,
    });
  }

  // Validace tvaru nabídky (striktní schema pro Lidl).
  const parsed = parseLidlPageOffersJson(JSON.stringify(body.offers), {
    fillMissingNullKeys: true,
  });
  if (!parsed.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Validace JSON selhala.",
        },
        validation_errors: parsed.errors,
        request_id: requestId,
      },
      { status: 422 }
    );
  }

  const offers = parsed.offers;
  const rowStatus = body.row_status ?? {};
  const pageNo =
    body.page_no ??
    (offers.find((o) => o.page_no != null)?.page_no ?? null);
  const committedAt = new Date().toISOString();
  const actor = (body.actor ?? "").trim() || null;

  // V tvém schématu je "batch" = řádek v tabulce imports.
  const inferredSourceType =
    (offers.find((o) => (o as any)?.source_type)?.source_type as string | undefined) ??
    (body.retailer ?? "leaflet");

  const noteParts = [
    actor ? `actor:${actor}` : null,
    body.original_filename ? `file:${body.original_filename}` : null,
    pageNo != null ? `page:${pageNo}` : null,
    `ui_commit:${committedAt}`,
  ].filter(Boolean);

  const todayIso = new Date().toISOString().slice(0, 10);
  const fallbackAllowed = canUseNonTransactionalFallback(
    process.env.NODE_ENV,
    process.env.ALLOW_NON_TRANSACTIONAL_FALLBACK
  );

  try {
    const result = await withPgClient(async (client) => {
      await client.query("BEGIN");
      try {
        const imp = await createImportRun(client, {
          source_type: String(inferredSourceType || "leaflet"),
          source_url: body.source_url ?? null,
          note: noteParts.join(" | ") || null,
        });

        const mapped = mapOffersForImportRun({
          offers,
          row_status: rowStatus as Record<number, RowStatus | undefined>,
          meta: {
            import_id: imp.id,
            source_type: String(inferredSourceType || "leaflet"),
            source_url: body.source_url ?? null,
            today_iso: todayIso,
          },
        });

        const rawInserted = await bulkInsertOffersRaw(client, mapped.rawRows);
        const quarantineInserted = await bulkInsertOffersQuarantine(client, mapped.quarantineRows);

        await client.query("COMMIT");

        console.info("[commit]", {
          import_id: imp.id,
          batch_no: imp.batch_no,
          offers_raw: rawInserted,
          offers_quarantine: quarantineInserted,
          required_field_errors: mapped.requiredFieldErrors.length,
        });

        return {
          import: imp,
          rawInserted,
          quarantineInserted,
          requiredFieldErrors: mapped.requiredFieldErrors,
        };
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    });

    return NextResponse.json({
      ok: true,
      batch_id: result.import.id,
      import_id: result.import.id,
      batch_no: result.import.batch_no,
      committed_approved: result.rawInserted,
      committed_raw_count: result.rawInserted,
      committed_staging: offers.length,
      quarantined: result.quarantineInserted,
      quarantined_count: result.quarantineInserted,
      required_field_errors: result.requiredFieldErrors,
      required_field_errors_count: result.requiredFieldErrors.length,
      committed_at: committedAt,
      actor,
      tx_guarantee: "all_or_nothing",
      fallback_used: null,
    });
  } catch (e) {
    if (!fallbackAllowed) {
      console.error("[commit] transactional commit failed; fallback blocked", {
        error: e instanceof Error ? e.message : String(e),
        node_env: process.env.NODE_ENV ?? "unknown",
      });
      return NextResponse.json(
        {
          ok: false,
          error:
            "Commit do DB selhal. Netransakční fallback je v produkci zakázaný, aby nevznikly částečné zápisy.",
          tx_guarantee: "none",
          fallback_used: null,
          fallback_blocked: true,
        },
        { status: 500 }
      );
    }

    // Development-safe fallback for environments where direct Postgres host is unreachable.
    const supabase = getSupabaseAdmin();
    if (supabase) {
      try {
        const { data: imp, error: impErr } = await supabase
          .from("imports")
          .insert({
            source_type: String(inferredSourceType || "leaflet"),
            source_url: body.source_url ?? null,
            note: noteParts.join(" | ") || null,
          })
          .select("id,batch_no")
          .single();
        if (impErr || !imp?.id) throw new Error(impErr?.message || "Nepodařilo se vytvořit import");

        const mapped = mapOffersForImportRun({
          offers,
          row_status: rowStatus as Record<number, RowStatus | undefined>,
          meta: {
            import_id: imp.id as string,
            source_type: String(inferredSourceType || "leaflet"),
            source_url: body.source_url ?? null,
            today_iso: todayIso,
          },
        });

        if (mapped.rawRows.length) {
          const { error } = await supabase.from("offers_raw").insert(mapped.rawRows as any[]);
          if (error) throw new Error(error.message);
        }
        if (mapped.quarantineRows.length) {
          const { error } = await supabase.from("offers_quarantine").insert(mapped.quarantineRows as any[]);
          if (error) throw new Error(error.message);
        }

        return NextResponse.json({
          ok: true,
          batch_id: imp.id,
          import_id: imp.id,
          batch_no: imp.batch_no ?? null,
          committed_approved: mapped.counts.raw,
          committed_raw_count: mapped.counts.raw,
          committed_staging: offers.length,
          quarantined: mapped.counts.quarantine,
          quarantined_count: mapped.counts.quarantine,
          required_field_errors: mapped.requiredFieldErrors,
          required_field_errors_count: mapped.requiredFieldErrors.length,
          committed_at: committedAt,
          actor,
          fallback_used: "supabase-js",
          tx_guarantee: "best_effort_non_transactional",
        });
      } catch (fallbackErr) {
        console.error("[commit] supabase fallback failed", {
          error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        });
        return NextResponse.json(
          {
            ok: false,
            error:
              "Commit do DB selhal. Nepodařilo se připojit přes transakční PG ani přes Supabase fallback.",
            tx_guarantee: "none",
            fallback_used: "supabase-js",
          },
          { status: 500 }
        );
      }
    }

    console.error("[commit] postgres unavailable and fallback not configured", {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      {
        ok: false,
        error:
          "Commit do DB selhal. Pro transakční import nastav SUPABASE_DB_URL (nebo DATABASE_URL) na Postgres připojení.",
        tx_guarantee: "none",
        fallback_used: null,
      },
      { status: 500 }
    );
  }
}

