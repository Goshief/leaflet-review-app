import { NextRequest, NextResponse } from "next/server";
import { parseLidlPageOffersJson } from "@/lib/lidl-parser";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: { text?: string; store_id?: string };
  try {
    body = (await req.json()) as any;
  } catch {
    return NextResponse.json({ ok: false, error: "Očekávám JSON body" }, { status: 400 });
  }

  const text = (body.text ?? "").toString();
  if (!text.trim()) {
    return NextResponse.json({ ok: false, error: "Vlož JSON výstup k otestování." }, { status: 400 });
  }

  // Momentálně validujeme proti našemu striktnímu schématu (LidlPageOffer).
  // Store-specific prompt může být různý, ale výstup musí sedět na schema.
  const parsed = parseLidlPageOffersJson(text, { fillMissingNullKeys: true });
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: "Validace JSON selhala", validation_errors: parsed.errors },
      { status: 422 }
    );
  }

  return NextResponse.json({ ok: true, offers: parsed.offers, store_id: body.store_id ?? null });
}

