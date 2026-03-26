import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";
import {
  executePatchUpdate,
  parsePatchBody,
  type PatchBody,
} from "@/lib/batches/item-update-route-logic";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function PATCH(req: NextRequest) {
  const requestId = makeRequestId();
  try {
    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return NextResponse.json({ ok: false, error: "Očekávám JSON body" }, { status: 400 });
    }

    let parsed;
    try {
      parsed = parsePatchBody(body);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Neplatný patch" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Supabase není nakonfigurované. Doplň NEXT_PUBLIC_SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY do .env.local.",
        },
        { status: 500 }
      );
    }

    const result = await executePatchUpdate(supabase, parsed);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    console.info("[batch-item-update]", {
      request_id: requestId,
      source_table: parsed.sourceTable,
      id: parsed.id,
      import_id: parsed.importId,
      updated_fields: result.updatedFields,
    });

    return NextResponse.json({
      ok: true,
      item: result.item,
    });
  } catch (e) {
    return safeErrorJson({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Úpravu položky se nepodařilo uložit.",
      requestId,
      cause: e,
      logContext: { route: "/api/batches/item" },
    });
  }
}
