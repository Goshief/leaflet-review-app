import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OcrWord } from "@/lib/ocr/types";
import { extractLeafletCandidates } from "@/lib/leaflet-review/extractor";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "leaflet-intake";
const SOURCE_PATH = "billa/billa-2026-08-19__a7a0e1fef9b45d3b.pdf";
const DEBUG_RE = /^(?:Kuře|Anglická|slanina|Pilsner|Urquell|Toaletní|papír|1 m|Milka|Čokoláda)$/i;

async function loadPdfDocument(bytes: Uint8Array) {
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = { WorkerMessageHandler: worker.WorkerMessageHandler };
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}

async function pageWords(doc: any, pageNo: number): Promise<OcrWord[]> {
  const page = await doc.getPage(pageNo);
  const content = await page.getTextContent();
  const words: OcrWord[] = [];
  for (const raw of content.items) {
    if (!("str" in raw) || typeof raw.str !== "string") continue;
    const text = raw.str.trim();
    if (!text) continue;
    const t = Array.isArray(raw.transform) ? raw.transform : [1, 0, 0, 1, 0, 0];
    words.push({
      text,
      x: Number(t[4] ?? 0),
      y: Number(t[5] ?? 0),
      w: Math.max(1, Number(raw.width ?? text.length * 5)),
      h: Math.max(1, Number(raw.height ?? Math.abs(Number(t[3] ?? 10)))),
    });
  }
  return words;
}

export async function GET() {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;
  const s = getSupabaseAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });

  let doc: any = null;
  try {
    const { data: source, error } = await s.storage.from(BUCKET).download(SOURCE_PATH);
    if (error || !source) throw new Error(error?.message || "BILLA PDF chybí.");
    const bytes = new Uint8Array(await source.arrayBuffer());
    doc = await loadPdfDocument(bytes);
    const words = await pageWords(doc, 1);
    const candidates = extractLeafletCandidates(words, {
      pageNo: 1,
      validFrom: "2026-08-19",
      validTo: "2026-08-25",
    });

    const genericMixed = candidates.filter((r) => {
      const text = String(r.source_text || "");
      const names = Array.isArray(r.extraction_payload?.name_candidates)
        ? (r.extraction_payload.name_candidates as unknown[])
        : [];
      return names.length >= 4 || text.split(" | ").length >= 13;
    });
    const knownContamination = candidates.filter((r) => {
      const text = String(r.source_text || "");
      return (/\bKuře\b/i.test(text) && /Anglická\s*\|?\s*slanina/i.test(text)) ||
        (/\bPilsner\b/i.test(text) && /1\s*m\s*=\s*0,28/i.test(text));
    });
    const named = candidates.filter((r) => typeof r.product_name === "string" && r.product_name.trim());
    const quarantine = candidates.filter((r) => r.status === "quarantine");
    const debugWords = words.filter((w) => DEBUG_RE.test(w.text.trim())).map((w) => ({ text: w.text, x: w.x, y: w.y, w: w.w, h: w.h }));

    return NextResponse.json({
      ok: true,
      page_no: 1,
      extractor_version: candidates[0]?.extractor_version ?? null,
      total: candidates.length,
      named: named.length,
      quarantine: quarantine.length,
      suspiciously_mixed: genericMixed.length,
      known_contamination: knownContamination.length,
      debug_words: debugWords,
      candidates: candidates.map((r) => ({
        key: r.candidate_key,
        name: r.product_name,
        price: r.price_sale,
        standard: r.price_standard,
        loyalty: r.price_loyalty,
        without_loyalty: r.price_without_loyalty,
        pack: r.pack_text,
        status: r.status,
        reason: r.review_reason,
        source: r.source_text,
        bounds: r.extraction_payload?.block_bounds ?? null,
        name_candidates: r.extraction_payload?.name_candidates ?? [],
      })),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    if (doc) await doc.destroy();
  }
}
