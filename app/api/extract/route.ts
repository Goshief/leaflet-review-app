import { extractWordsFromImageBuffer, runOcrPipeline } from "@/lib/ocr";
import { NextRequest, NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "leaflet-intake";
const ALLOWED_IMAGE = /^image\/(jpeg|png|webp|gif)$/i;

type ExtractResponse =
  | {
      ok: true;
      mode: "extract";
      offers: unknown[];
      model: string;
      page_no: number | null;
      source_url: string | null;
      ocr_raw: {
        word_count: number;
        words: unknown[];
        price_anchors: unknown[];
      };
    }
  | { ok: false; error: string };

function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

async function loadFromIntake(intakeId: string): Promise<{ buf: Buffer; mime: string }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase Storage není nakonfigurovaný.");

  const { data: files, error: listError } = await supabase.storage
    .from(BUCKET)
    .list("", { search: intakeId, limit: 10 });
  if (listError) throw new Error(listError.message);

  const match = (files ?? []).find((file) => file.name.startsWith(`${intakeId}.`));
  if (!match) throw new Error("intake_id nenalezen ve Storage.");

  const { data, error } = await supabase.storage.from(BUCKET).download(match.name);
  if (error || !data) throw new Error(error?.message ?? "Soubor ze Storage nelze stáhnout.");
  return { buf: Buffer.from(await data.arrayBuffer()), mime: mimeFromName(match.name) };
}

export async function POST(req: NextRequest) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Očekávám multipart/form-data" } satisfies ExtractResponse, { status: 400 });
  }

  const intake = form.get("intake_id");
  const file = form.get("file");
  let buf: Buffer;
  let mime: string;

  if (typeof intake === "string" && intake.trim()) {
    try {
      const loaded = await loadFromIntake(intake.trim());
      buf = loaded.buf;
      mime = loaded.mime;
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Intake load selhal" } satisfies ExtractResponse, { status: 404 });
    }
  } else if (file instanceof File) {
    mime = file.type || "application/octet-stream";
    if (!ALLOWED_IMAGE.test(mime)) {
      return NextResponse.json({ ok: false, error: "Pro OCR pošli obrázek stránky (PNG/JPEG/WebP/GIF)." } satisfies ExtractResponse, { status: 400 });
    }
    buf = Buffer.from(await file.arrayBuffer());
  } else {
    return NextResponse.json({ ok: false, error: "Pošli 'file' (obrázek) nebo 'intake_id'." } satisfies ExtractResponse, { status: 400 });
  }

  if (!ALLOWED_IMAGE.test(mime)) {
    return NextResponse.json({ ok: false, error: "OCR endpoint očekává obrázek stránky; PDF se nejdřív renderuje na PNG." } satisfies ExtractResponse, { status: 400 });
  }

  const pageNoRaw = form.get("page_no");
  let page_no: number | null = null;
  if (typeof pageNoRaw === "string" && pageNoRaw.trim()) {
    const n = Number(pageNoRaw);
    if (Number.isFinite(n) && n >= 1) page_no = Math.floor(n);
  }

  const su = form.get("source_url");
  const source_url = typeof su === "string" && su.trim() ? su.trim() : null;

  try {
    const words = await extractWordsFromImageBuffer(buf);
    const pipeline = runOcrPipeline(words, page_no);
    return NextResponse.json({
      ok: true,
      mode: "extract",
      offers: pipeline.offers,
      model: "tesseract.js (ces+eng) + kotva ceny + heuristika",
      page_no,
      source_url,
      ocr_raw: {
        word_count: pipeline.ocr_words.length,
        words: pipeline.ocr_words,
        price_anchors: pipeline.price_anchors,
      },
    } satisfies ExtractResponse);
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Extract/OCR selhal: ${e instanceof Error ? e.message : "OCR selhal"}` } satisfies ExtractResponse, { status: 502 });
  }
}
