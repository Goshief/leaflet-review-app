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
    const words = await pageWords(doc, 1);
    const candidates = extractLeafletCandidates(words, { pageNo: 1, validFrom: "2026-08-19", validTo: "2026-08-25" });
    const at = (price: number) => candidates.filter((r) => eq(r.price_sale, price));
    const bySource = (price: number, rx: RegExp) => at(price).find((r) => rx.test(String(r.source_text || "")));
    const name = (r: ReturnType<typeof bySource>) => String(r?.product_name || "").trim();
    const checks = [
      { id: "milka_cokolada", value: name(bySource(24.9, /Milka|Čokoláda/i)), ok: /Čokoláda/i.test(name(bySource(24.9, /Milka|Čokoláda/i))) },
      { id: "kure", value: name(bySource(49.9, /\bKuře\b/i)), ok: /^Kuře$/i.test(name(bySource(49.9, /\bKuře\b/i))) },
      { id: "pilsner_urquell", value: name(bySource(28.83, /Urquell/i)), ok: /Urquell/i.test(name(bySource(28.83, /Urquell/i))) && !/\bplech\b|KOMBO/i.test(name(bySource(28.83, /Urquell/i))) },
      { id: "jihoceske_maslo", value: name(bySource(32.9, /Jihočeské\s+máslo/i)), ok: /máslo/i.test(name(bySource(32.9, /Jihočeské\s+máslo/i))) },
      { id: "veprova_pecene", value: name(bySource(74.9, /Vepřová/i)), ok: /Vepřová/i.test(name(bySource(74.9, /Vepřová/i))) && /pečeně/i.test(name(bySource(74.9, /Vepřová/i))) },
      { id: "rajcata", value: name(bySource(39.9, /Rajčata/i)), ok: /Rajčata/i.test(name(bySource(39.9, /Rajčata/i))) && !/balení|250\s*g/i.test(name(bySource(39.9, /Rajčata/i))) },
      { id: "toaletni_papir", value: name(bySource(99.9, /Toaletní|papír/i)), ok: /Toaletní/i.test(name(bySource(99.9, /Toaletní|papír/i))) && /papír/i.test(name(bySource(99.9, /Toaletní|papír/i))) },
      { id: "toffifee", value: name(bySource(29.9, /Toffifee/i)), ok: /^Toffifee$/i.test(name(bySource(29.9, /Toffifee/i))) },
      { id: "tvaroh", value: name(bySource(18.9, /Tvaroh/i)), ok: /Tvaroh/i.test(name(bySource(18.9, /Tvaroh/i))) && !/250\s*g/i.test(name(bySource(18.9, /Tvaroh/i))) },
      { id: "prosecco", value: name(bySource(259.8, /Prosecco/i)), ok: /Prosecco/i.test(name(bySource(259.8, /Prosecco/i))) && !/^KOMBO$/i.test(name(bySource(259.8, /Prosecco/i))) },
    ];
    const failures = checks.filter((c) => !c.ok).map((c) => c.id);
    return NextResponse.json({ ok: true, point_5a: { pass: failures.length === 0, checks, failures }, extractor_version: candidates[0]?.extractor_version ?? null });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    if (doc) await doc.destroy();
  }
}
