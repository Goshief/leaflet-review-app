import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import type { OcrWord } from "@/lib/ocr/types";
import { extractLeafletCandidates } from "@/lib/leaflet-review/extractor";

export const runtime = "nodejs";

function word(text: string, x: number, y: number, w = 58, h = 10): OcrWord {
  return { text, x, y, w, h };
}

function runCase(promo: string, product: string) {
  const words: OcrWord[] = [
    word("29,90", 100, 100, 48, 30),
    word(product, 92, 120, 82, 11),
    word(promo, 90, 142, 92, 11),
  ];
  const rows = extractLeafletCandidates(words, { pageNo: 1, validFrom: "2026-08-20", validTo: "2026-08-23" });
  return rows[0] ?? null;
}

export async function GET() {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const cases = [
    { id: "super_cena", promo: "SUPER CENA", product: "Bílé hrozny" },
    { id: "lidl_plus", promo: "S LIDL PLUS", product: "MÍŠA Nanuk" },
    { id: "usetrete", promo: "UŠETŘETE 30 Kč", product: "Vepřová krkovice" },
  ].map((c) => {
    const row = runCase(c.promo, c.product);
    const name = String(row?.product_name || "");
    return {
      id: c.id,
      product_name: name || null,
      source_text: row?.source_text ?? null,
      status: row?.status ?? null,
      review_reason: row?.review_reason ?? null,
      name_candidates: row?.extraction_payload?.name_candidates ?? null,
      name_lines: row?.extraction_payload?.name_lines ?? null,
      ambiguous_name: row?.extraction_payload?.ambiguous_name ?? null,
      ok: Boolean(name && name.toLocaleLowerCase("cs-CZ").includes(c.product.toLocaleLowerCase("cs-CZ")) && !name.toLocaleLowerCase("cs-CZ").includes(c.promo.toLocaleLowerCase("cs-CZ"))),
    };
  });

  const failures = cases.filter((c) => !c.ok).map((c) => c.id);
  return NextResponse.json({ ok: true, pass: failures.length === 0, cases, failures });
}
