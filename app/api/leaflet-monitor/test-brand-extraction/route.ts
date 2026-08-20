import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OcrWord } from "@/lib/ocr/types";
import { extractLeafletCandidates } from "@/lib/leaflet-review/extractor";
import { applyBrandAliases, loadBrandAliases } from "@/lib/leaflet-review/brand-resolver";

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

async function pageWords(doc: any): Promise<OcrWord[]> {
  const page = await doc.getPage(1);
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
    const aliases = await loadBrandAliases(s);
    const candidates = extractLeafletCandidates(await pageWords(doc), { pageNo: 1, validFrom: "2026-08-19", validTo: "2026-08-25" }).map((c) => applyBrandAliases(c, aliases));
    const atPrice = (price: number) => candidates.find((c) => eq(c.price_sale, price));
    const checks = [
      { id: "milka_brand", value: atPrice(24.9)?.brand ?? null, ok: atPrice(24.9)?.brand === "Milka" },
      { id: "linteo_brand", value: atPrice(99.9)?.brand ?? null, ok: atPrice(99.9)?.brand === "Linteo" },
      { id: "toffifee_brand", value: atPrice(29.9)?.brand ?? null, ok: atPrice(29.9)?.brand === "Toffifee" },
      { id: "kure_no_guess", value: atPrice(49.9)?.brand ?? null, ok: atPrice(49.9)?.brand == null },
      { id: "prosecco_no_guess", value: atPrice(259.8)?.brand ?? null, ok: atPrice(259.8)?.brand == null },
      { id: "maslo_no_guess", value: atPrice(32.9)?.brand ?? null, ok: atPrice(32.9)?.brand == null },
    ];
    const failures = checks.filter((c) => !c.ok).map((c) => c.id);
    return NextResponse.json({ ok: true, point_5b: { pass: failures.length === 0, checks, failures }, aliases: aliases.length });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    if (doc) await doc.destroy();
  }
}
