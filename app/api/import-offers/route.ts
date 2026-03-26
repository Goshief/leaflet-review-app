import { NextResponse } from "next/server";

import {
  parseLidlPageOffersJson,
  type LidlPageOffer,
} from "@/lib/lidl-parser/lidl-page-offer";

type ImportReq = {
  text: string;
};

function parseNumberLike(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  if (s === "null") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseBooleanLike(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (!s || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  return null;
}

function parseTypicalPerUnit(v: string): number | null {
  const s = v.trim();
  if (!s || s === "null") return null;
  // např. '1 l = 51,80 Kč' -> 51.80
  const m = s.match(/=\s*([0-9]+(?:[.,][0-9]{1,2})?)/);
  if (m) return parseNumberLike(m[1] ?? "");
  return parseNumberLike(s);
}

function parseCsvLineSemicolon(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQ = true;
      continue;
    }
    if (ch === ";") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function fromSemicolonCsv(text: string): LidlPageOffer[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const header = parseCsvLineSemicolon(lines[0] ?? "");
  const offers: LidlPageOffer[] = [];

  for (let li = 1; li < lines.length; li++) {
    const row = parseCsvLineSemicolon(lines[li] ?? "");
    const rec: Record<string, string> = {};
    header.forEach((h, i) => {
      rec[h] = row[i] ?? "";
    });

    const hasLoyalty = parseBooleanLike(rec["has_loyalty_card_price"] ?? "null");
    const offer: LidlPageOffer = {
      store_id: "lidl",
      source_type: "leaflet",
      page_no: parseNumberLike(rec["page_no"] ?? "null"),
      valid_from:
        (rec["valid_from"] ?? "").trim() === "null"
          ? null
          : (rec["valid_from"] ?? "").trim() || null,
      valid_to:
        (rec["valid_to"] ?? "").trim() === "null"
          ? null
          : (rec["valid_to"] ?? "").trim() || null,
      valid_from_text:
        (rec["valid_from_text"] ?? "").trim() === "null"
          ? null
          : (rec["valid_from_text"] ?? "").trim() || null,
      valid_to_text:
        (rec["valid_to_text"] ?? "").trim() === "null"
          ? null
          : (rec["valid_to_text"] ?? "").trim() || null,
      extracted_name:
        (rec["extracted_name"] ?? "").trim() === "null"
          ? null
          : (rec["extracted_name"] ?? "").trim() || null,
      price_total: parseNumberLike(rec["price_total"] ?? "null"),
      currency: "CZK",
      pack_qty: parseNumberLike(rec["pack_qty"] ?? "null"),
      pack_unit:
        (rec["pack_unit"] ?? "").trim() === "null"
          ? null
          : (rec["pack_unit"] ?? "").trim() || null,
      pack_unit_qty: parseNumberLike(rec["pack_unit_qty"] ?? "null"),
      price_standard: parseNumberLike(rec["price_standard"] ?? "null"),
      typical_price_per_unit: parseTypicalPerUnit(
        rec["typical_price_per_unit"] ?? "null"
      ),
      price_with_loyalty_card:
        hasLoyalty === true
          ? parseNumberLike(rec["price_with_loyalty_card"] ?? "null")
          : null,
      has_loyalty_card_price: hasLoyalty,
      notes:
        (rec["notes"] ?? "").trim() === "null"
          ? null
          : (rec["notes"] ?? "").trim() || null,
      brand:
        (rec["brand"] ?? "").trim() === "null"
          ? null
          : (rec["brand"] ?? "").trim() || null,
      category:
        (rec["category"] ?? "").trim() === "null"
          ? null
          : (rec["category"] ?? "").trim() || null,
      raw_text_block:
        (rec["raw_text_block"] ?? "").trim() === "null"
          ? null
          : (rec["raw_text_block"] ?? "").trim() || null,
    };
    offers.push(offer);
  }
  return offers;
}

export async function POST(req: Request) {
  let body: ImportReq;
  try {
    body = (await req.json()) as ImportReq;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }
  const text = (body.text ?? "").toString().trim();
  if (!text) {
    return NextResponse.json({ ok: true, offers: [], model: "manual" });
  }

  // Auto-detekce: JSON pole nebo semicolon CSV z Excelu
  if (text.startsWith("[")) {
    const r = parseLidlPageOffersJson(text, { fillMissingNullKeys: true });
    if (!r.ok) {
      return NextResponse.json(
        { error: "Validace JSON selhala", validation_errors: r.errors },
        { status: 422 }
      );
    }
    return NextResponse.json({ ok: true, offers: r.offers, model: "manual-json" });
  }

  if (text.includes(";")) {
    const offers = fromSemicolonCsv(text);
    return NextResponse.json({ ok: true, offers, model: "manual-csv" });
  }

  return NextResponse.json(
    {
      error:
        "Neznámý formát. Vlož buď JSON pole [...], nebo semicolon CSV (hlavička + řádky).",
    },
    { status: 400 }
  );
}

