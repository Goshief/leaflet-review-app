import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";

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
  const requestId = makeRequestId();

  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Očekávám multipart/form-data" } satisfies IntakeResponse,
        { status: 400 }
      );
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

    const intake_id = randomUUID();
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
    await mkdir(baseDir, { recursive: true });

    const stored_path = path.join(baseDir, `${intake_id}.${ext}`);
    await writeFile(stored_path, buf);

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
  } catch (cause) {
    return safeErrorJson({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Upload se nepodařilo uložit.",
      requestId,
      cause,
      logContext: { route: "/api/intake" },
    });
  }
}
