import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OcrWord } from "@/lib/ocr/types";
import { extractLeafletCandidates } from "@/lib/leaflet-review/extractor";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "leaflet-intake";
const SOURCE_PATH = "billa/billa-2026-08-19__a7a0e1fef9b45d3b.pdf";

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
    words.push({ text, x: Number(t[4] ?? 0), y: Number(t[5] ?? 0), w: Math.max(1, Number(raw.width ?? text.length * 5)), h: Math.max(1, Number(raw.height ?? Math.abs(Number(t[3] ?? 10)))) });
  }
  return words;
}

const eq = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.001;

export async function GET() {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;
  const s = getSupabaseAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });
  let doc: any = null;
  try {
    const { data: source, error } = await s.storage.from(BUCKET).download(SOURCE_PATH);
    if (error || !source) throw new Error(error?.message || "BILLA PDF chybí.");
    doc = await loadPdfDocument(new Uint8Array(await source.arrayBuffer()));
    const candidates = extractLeafletCandidates(await pageWords(doc, 2), { pageNo: 2, validFrom: "2026-08-19", validTo: "2026-08-25" });
    const at = (price: number) => candidates.filter((r) => eq(r.price_sale, price));
    const bySource = (price: number, rx: RegExp) => at(price).find((r) => rx.test(String(r.source_text || "")) || rx.test(String(r.product_name || "")));
    const value = (price: number, rx: RegExp) => bySource(price, rx);
    const checks = [
      { id: "eidam", row: value(14.9, /Eidam/i), name: /Eidam/i },
      { id: "lucina", row: value(42.9, /Lučina|Svěží/i), name: /Lučina|Svěží/i },
      { id: "merci", row: value(199.9, /Merci/i), name: /Merci/i },
      { id: "znojmia", row: value(39.9, /Znojmia|Okurky/i), name: /Znojmia|Okurky/i },
      { id: "tchibo", row: value(89.9, /Tchibo|Cafissimo/i), name: /Tchibo|Cafissimo/i },
      { id: "drwitt", row: value(16.9, /DrWitt/i), name: /DrWitt/i },
      { id: "radegast", row: value(19.9, /Radegast|Ryze|hořká/i), name: /Radegast/i },
      { id: "st_nicolaus", row: value(129.9, /Nicolaus|vodka/i), name: /Nicolaus/i },
      { id: "sheba", row: value(449.9, /Kapsičky pro kočky/i), name: /Kapsičky pro kočky/i },
      { id: "burrata", row: value(29.9, /Burrata|BILLA Premium/i), name: /Burrata/i },
    ].map((c) => ({
      id: c.id,
      value: c.row ? { product_name: c.row.product_name, pack_text: c.row.pack_text, price_sale: c.row.price_sale, source_text: c.row.source_text } : null,
      ok: Boolean(c.row && c.row.product_name && c.name.test(c.row.product_name)),
    }));
    const failures = checks.filter((c) => !c.ok).map((c) => c.id);
    return NextResponse.json({ ok: true, page: 2, extractor_version: candidates[0]?.extractor_version ?? null, candidate_count: candidates.length, pass: failures.length === 0, checks, failures });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    if (doc) await doc.destroy();
  }
}
