import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OcrWord } from "@/lib/ocr/types";

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

export async function GET() {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;
  const s = getSupabaseAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });
  let doc: any = null;
  try {
    const { data, error } = await s.storage.from(BUCKET).download(SOURCE_PATH);
    if (error || !data) throw new Error(error?.message || "BILLA PDF chybí.");
    doc = await loadPdfDocument(new Uint8Array(await data.arrayBuffer()));
    const page = await doc.getPage(2);
    const content = await page.getTextContent();
    const words: OcrWord[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || typeof raw.str !== "string") continue;
      const text = raw.str.trim();
      if (!text) continue;
      const t = Array.isArray(raw.transform) ? raw.transform : [1, 0, 0, 1, 0, 0];
      words.push({ text, x: Number(t[4] ?? 0), y: Number(t[5] ?? 0), w: Math.max(1, Number(raw.width ?? text.length * 5)), h: Math.max(1, Number(raw.height ?? Math.abs(Number(t[3] ?? 10)))) });
    }
    const focus = words.filter((w) => /Sheba|Kapsičky|kočky|449,90|40×|85\s*g/i.test(w.text));
    const anchor = words.find((w) => /^449,90\/?$/.test(w.text.trim()));
    const around = anchor ? words.filter((w) => Math.abs((w.x + w.w / 2) - (anchor.x + anchor.w / 2)) <= 130 && Math.abs((w.y + w.h / 2) - (anchor.y + anchor.h / 2)) <= 120) : [];
    const compact = (w: OcrWord) => ({ text: w.text, x: Math.round(w.x * 10) / 10, y: Math.round(w.y * 10) / 10, w: Math.round(w.w * 10) / 10, h: Math.round(w.h * 10) / 10 });
    return NextResponse.json({ ok: true, focus: focus.map(compact), around: around.sort((a,b)=>b.y-a.y||a.x-b.x).map(compact) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    if (doc) await doc.destroy();
  }
}
