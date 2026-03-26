import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractWordsFromImageBuffer, runOcrPipeline } from "@/lib/ocr";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

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

async function loadFromIntake(intake_id: string): Promise<{
  buf: Buffer;
  mime: string;
  stored_path: string;
}> {
  const baseDir =
    process.env.LEAFLET_INTAKE_DIR?.trim() ||
    path.join(os.tmpdir(), "leaflet-intake");
  const entries = await fs.readdir(baseDir).catch(() => []);
  const match = entries.find((n) => n.startsWith(`${intake_id}.`));
  if (!match) {
    throw new Error("intake_id nenalezen (soubor už může být smazaný).");
  }
  const stored_path = path.join(baseDir, match);
  const buf = await fs.readFile(stored_path);
  const ext = stored_path.toLowerCase().split(".").pop() || "";
  const mime =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : ext === "gif"
          ? "image/gif"
          : ext === "jpg" || ext === "jpeg"
            ? "image/jpeg"
            : "application/octet-stream";
  return { buf, mime, stored_path };
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Očekávám multipart/form-data" } satisfies ExtractResponse,
      { status: 400 }
    );
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
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Intake load selhal" } satisfies ExtractResponse,
        { status: 404 }
      );
    }
  } else if (file instanceof File) {
    mime = file.type || "application/octet-stream";
    if (!ALLOWED_IMAGE.test(mime)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Zatím podporuji jen obrázek stránky (PNG/JPEG/WebP/GIF). PDF dej nejdřív přes klientské renderování na PNG nebo přes intake+worker.",
        } satisfies ExtractResponse,
        { status: 400 }
      );
    }
    buf = Buffer.from(await file.arrayBuffer());
  } else {
    return NextResponse.json(
      { ok: false, error: "Pošli 'file' (obrázek) nebo 'intake_id'." } satisfies ExtractResponse,
      { status: 400 }
    );
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
    return NextResponse.json(
      {
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
      } satisfies ExtractResponse,
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OCR selhal";
    return NextResponse.json(
      { ok: false, error: `Extract/OCR selhal: ${msg}` } satisfies ExtractResponse,
      { status: 502 }
    );
  }
}

