import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED = /^(application\/pdf|image\/(jpeg|png|webp|gif))$/i;

type IntakeResponse =
  | {
      ok: true;
      intake_id: string;
      original_name: string | null;
      mime: string;
      bytes: number;
      stored_path: string;
      created_at: string;
    }
  | { ok: false; error: string };

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Očekávám multipart/form-data" } satisfies IntakeResponse, {
      status: 400,
    });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Pole 'file' musí být PDF nebo obrázek." } satisfies IntakeResponse,
      { status: 400 }
    );
  }

  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.test(mime)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Nepodporovaný typ. Pošli application/pdf nebo image/jpeg|png|webp|gif.",
      } satisfies IntakeResponse,
      { status: 400 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 60 * 1024 * 1024) {
    return NextResponse.json(
      { ok: false, error: "Soubor je větší než 60 MB." } satisfies IntakeResponse,
      { status: 400 }
    );
  }

  const intake_id = crypto.randomUUID();
  const ext =
    mime === "application/pdf"
      ? "pdf"
      : mime.toLowerCase().includes("png")
        ? "png"
        : mime.toLowerCase().includes("webp")
          ? "webp"
          : mime.toLowerCase().includes("gif")
            ? "gif"
            : "jpg";

  const baseDir =
    process.env.LEAFLET_INTAKE_DIR?.trim() ||
    path.join(os.tmpdir(), "leaflet-intake");
  await fs.mkdir(baseDir, { recursive: true });

  const stored_path = path.join(baseDir, `${intake_id}.${ext}`);
  await fs.writeFile(stored_path, buf);

  return NextResponse.json(
    {
      ok: true,
      intake_id,
      original_name: file.name || null,
      mime,
      bytes: buf.length,
      stored_path,
      created_at: new Date().toISOString(),
    } satisfies IntakeResponse,
    { status: 200 }
  );
}

