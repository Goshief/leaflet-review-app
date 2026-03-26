import { extractWordsFromImageBuffer, runOcrPipeline } from "@/lib/ocr";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED_IMAGE = /^image\/(jpeg|png|webp|gif)$/i;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Očekávám multipart/form-data" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      {
        error:
          "Pole 'file' musí být obrázek stránky letáku (JPEG, PNG, WebP, GIF).",
      },
      { status: 400 }
    );
  }

  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_IMAGE.test(mime)) {
    return NextResponse.json(
      {
        error:
          "Nepodporovaný typ. Pošli obrázek (PNG z PDF stránky nebo JPEG).",
      },
      { status: 400 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Soubor je větší než 25 MB" },
      { status: 400 }
    );
  }

  const pageNoRaw = form.get("page_no");
  let page_no: number | null = null;
  if (typeof pageNoRaw === "string" && pageNoRaw.trim()) {
    const n = Number(pageNoRaw);
    if (!Number.isFinite(n) || n < 1) {
      return NextResponse.json(
        { error: "page_no musí být kladné celé číslo" },
        { status: 400 }
      );
    }
    page_no = Math.floor(n);
  }

  const su = form.get("source_url");
  const source_url =
    typeof su === "string" && su.trim() ? su.trim() : null;

  let words;
  try {
    words = await extractWordsFromImageBuffer(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OCR selhal";
    return NextResponse.json(
      {
        error: `OCR (Tesseract): ${msg}`,
      },
      { status: 502 }
    );
  }

  const pipeline = runOcrPipeline(words, page_no);

  return NextResponse.json({
    ok: true,
    mode: "ocr" as const,
    offers: pipeline.offers,
    model: "tesseract.js (ces+eng) + kotva ceny + heuristika",
    page_no,
    source_url,
    ocr_raw: {
      word_count: pipeline.ocr_words.length,
      words: pipeline.ocr_words,
      price_anchors: pipeline.price_anchors,
    },
  });
}
