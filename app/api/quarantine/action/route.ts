import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  action: "approve" | "reject" | "return";
  ids: string[];
};

export async function POST(req: NextRequest) {
  const requestId = makeRequestId();
  try {
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ ok: false, error: "Očekávám JSON body" }, { status: 400 });
    }

    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (!ids.length) {
      return NextResponse.json({ ok: false, error: "Chybí ids" }, { status: 400 });
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

    if (body.action === "approve") {
    // Načti karanténní řádky.
    const { data: rows, error } = await supabase
      .from("offers_quarantine")
      .select(
        [
          "id",
          "import_id",
          "store_id",
          "source_type",
          "source_url",
          "valid_from",
          "valid_to",
          "extracted_name",
          "price_total",
          "currency",
          "pack_qty",
          "pack_unit",
          "pack_unit_qty",
          "price_standard",
          "typical_price_per_unit",
          "price_with_loyalty_card",
          "has_loyalty_card_price",
          "notes",
          "brand",
          "category",
        ].join(",")
      )
      .in("id", ids)
      .limit(2000);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const payload = (rows ?? []) as any[];
    if (payload.length === 0) {
      return NextResponse.json({ ok: true, moved: 0 });
    }

    // Přesuň do offers_raw (schválené).
    const approvedRows = payload.map((o) => ({
      import_id: o.import_id,
      store_id: o.store_id ?? "lidl",
      source_type: o.source_type ?? "leaflet",
      source_url: o.source_url ?? null,
      valid_from: o.valid_from ?? null,
      valid_to: o.valid_to ?? o.valid_from ?? new Date().toISOString().slice(0, 10),
      extracted_name: o.extracted_name ?? null,
      price_total: o.price_total ?? null,
      currency: o.currency ?? "CZK",
      pack_qty: o.pack_qty ?? null,
      pack_unit: o.pack_unit ?? null,
      pack_unit_qty: o.pack_unit_qty ?? null,
      price_standard: o.price_standard ?? null,
      typical_price_per_unit: o.typical_price_per_unit ?? null,
      price_with_loyalty_card: o.price_with_loyalty_card ?? null,
      has_loyalty_card_price: o.has_loyalty_card_price ?? null,
      notes: o.notes ?? null,
      brand: o.brand ?? null,
      category: o.category ?? null,
      pipeline_version: "quarantine-approve",
      pipeline_note: null,
    }));

    const { error: insErr } = await supabase.from("offers_raw").insert(approvedRows);
    if (insErr) {
      return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }

    const { error: delErr } = await supabase.from("offers_quarantine").delete().in("id", ids);
    if (delErr) {
      return NextResponse.json(
        { ok: false, error: `Zapsáno, ale nepodařilo se smazat z karantény: ${delErr.message}` },
        { status: 500 }
      );
    }

      return NextResponse.json({ ok: true, moved: approvedRows.length });
    }

    if (body.action === "reject") {
      const { error } = await supabase
        .from("offers_quarantine")
        .update({ quarantine_reason: "rejected_in_quarantine" })
        .in("id", ids);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "return") {
      const { error } = await supabase
        .from("offers_quarantine")
        .update({ quarantine_reason: "returned_to_review" })
        .in("id", ids);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Neznámá akce" }, { status: 400 });
  } catch (e) {
    return safeErrorJson({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Akci nad karanténou se nepodařilo dokončit.",
      requestId,
      cause: e,
      logContext: { route: "/api/quarantine/action" },
    });
  }
}

