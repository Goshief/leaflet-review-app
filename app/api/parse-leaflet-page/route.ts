import { NextRequest, NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { parseLeafletPageFromPdfText } from "@/lib/leaflet-review/parse-page";
import type { OcrWord } from "@/lib/ocr/types";

export const runtime = "nodejs";

const MAX_WORDS = 20_000;

function asWord(raw: unknown): OcrWord | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.text !== "string" || !w.text.trim()) return null;
  const x = Number(w.x);
  const y = Number(w.y);
  const width = Number(w.w);
  const h = Number(w.h);
  if (![x, y, width, h].every((n) => Number.isFinite(n))) return null;
  return { text: w.text.trim(), x, y, w: Math.max(1, width), h: Math.max(1, h) };
}

export async function POST(req: NextRequest) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Očekávám JSON s polem words z PDF textové vrstvy." }, { status: 400 });
  }

  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawWords = rec.words;
  if (!Array.isArray(rawWords)) {
    return NextResponse.json({ error: "Pole 'words' musí být pole PDF textových tokenů." }, { status: 400 });
  }
  if (rawWords.length > MAX_WORDS) {
    return NextResponse.json({ error: "Příliš mnoho tokenů." }, { status: 400 });
  }

  const words: OcrWord[] = [];
  for (const item of rawWords) {
    const w = asWord(item);
    if (w) words.push(w);
  }

  const pageRaw = rec.page_no;
  let page_no: number | null = null;
  if (typeof pageRaw === "number" && Number.isFinite(pageRaw) && pageRaw >= 1) {
    page_no = Math.floor(pageRaw);
  } else if (typeof pageRaw === "string" && pageRaw.trim()) {
    const n = Number(pageRaw);
    if (Number.isFinite(n) && n >= 1) page_no = Math.floor(n);
  }

  const store_id =
    typeof rec.store_id === "string" && rec.store_id.trim()
      ? rec.store_id.trim().toLowerCase()
      : "lidl";
  const source_url =
    typeof rec.source_url === "string" && rec.source_url.trim()
      ? rec.source_url.trim()
      : null;

  const parsed = parseLeafletPageFromPdfText(words, page_no, store_id);

  return NextResponse.json({
    ok: true,
    mode: "pdf_text" as const,
    offers: parsed.offers,
    model: parsed.model,
    page_no,
    source_url,
    ocr_raw: {
      word_count: parsed.word_count,
      words,
      price_anchors: parsed.price_anchors,
    },
  });
}
