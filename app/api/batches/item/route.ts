import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";
import {
  executePatchUpdate,
  parsePatchBody,
  type PatchBody,
} from "@/lib/batches/item-update-route-logic";
import { isBatchItemTable, sanitizeBatchItemPatch, type BatchItemTable } from "@/lib/batches/item-update";

export const runtime = "nodejs";
export const maxDuration = 60;

type CreateBody = {
  import_id?: string;
  source_table?: BatchItemTable;
  patch?: unknown;
};

function parseCreateBody(body: CreateBody) {
  const importId = String(body.import_id ?? "").trim();
  const sourceTable = body.source_table;
  if (!importId || !isBatchItemTable(sourceTable)) {
    throw new Error("Body musí obsahovat import_id a source_table (offers_raw | offers_quarantine).");
  }
  const patch = sanitizeBatchItemPatch(body.patch);
  return { importId, sourceTable, patch };
}

export async function POST(req: NextRequest) {
  const requestId = makeRequestId();
  try {
    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return NextResponse.json({ ok: false, error: "Očekávám JSON body" }, { status: 400 });
    }

    let parsed;
    try {
      parsed = parseCreateBody(body);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Neplatná položka" },
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

    const insertPayload = {
      id: randomUUID(),
      import_id: parsed.importId,
      ...parsed.patch,
    };

    const result = await supabase
      .from(parsed.sourceTable)
      .insert(insertPayload)
      .select(
        "id, import_id, extracted_name, price_total, currency, pack_qty, pack_unit, pack_unit_qty, price_standard, typical_price_per_unit, price_with_loyalty_card, has_loyalty_card_price, notes, brand, category, valid_from, valid_to, created_at, suggested_image_key, approved_image_key, image_review_status"
      )
      .maybeSingle();

    if (result.error) {
      return NextResponse.json({ ok: false, error: result.error.message ?? "Insert failed" }, { status: 500 });
    }
    if (!result.data) {
      return NextResponse.json({ ok: false, error: "Položku se nepodařilo vytvořit." }, { status: 500 });
    }

    console.info("[batch-item-create]", {
      request_id: requestId,
      source_table: parsed.sourceTable,
      id: result.data.id,
      import_id: parsed.importId,
    });

    return NextResponse.json({
      ok: true,
      item: {
        ...result.data,
        source_table: parsed.sourceTable,
      },
    });
  } catch (e) {
    return safeErrorJson({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Položku se nepodařilo vytvořit.",
      requestId,
      cause: e,
      logContext: { route: "/api/batches/item", method: "POST" },
    });
  }
}

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
