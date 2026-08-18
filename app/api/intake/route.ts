import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "leaflet-intake";
const MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|image\/(jpeg|png|webp|gif))$/i;

type IntakeRequest = {
  name?: string | null;
  mime?: string | null;
  size?: number | null;
};

type IntakeResponse =
  | {
      ok: true;
      intake_id: string;
      original_name: string | null;
      mime: string;
      bytes: number;
      stored_path: string;
      created_at: string;
      upload_bucket: string;
      upload_path: string;
      upload_token: string;
    }
  | { ok: false; error: string };

function extensionForMime(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime.toLowerCase().includes("png")) return "png";
  if (mime.toLowerCase().includes("webp")) return "webp";
  if (mime.toLowerCase().includes("gif")) return "gif";
  return "jpg";
}

export async function POST(req: NextRequest) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const requestId = makeRequestId();

  try {
    let body: IntakeRequest;
    try {
      body = (await req.json()) as IntakeRequest;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Očekávám JSON metadata souboru." } satisfies IntakeResponse,
        { status: 400 }
      );
    }

    const mime = (body.mime ?? "").trim() || "application/octet-stream";
    const bytes = Number(body.size ?? 0);
    const originalName = (body.name ?? "").trim() || null;

    if (!ALLOWED.test(mime)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Nepodporovaný typ. Použij PDF, JPEG, PNG, WebP nebo GIF.",
        } satisfies IntakeResponse,
        { status: 400 }
      );
    }
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Soubor musí mít 1 B až 100 MB." } satisfies IntakeResponse,
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { ok: false, error: "Supabase Storage není nakonfigurovaný." } satisfies IntakeResponse,
        { status: 503 }
      );
    }

    const intake_id = randomUUID();
    const uploadPath = `${intake_id}.${extensionForMime(mime)}`;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(uploadPath, { upsert: false });

    if (error || !data?.token) {
      throw new Error(error?.message || "Nepodařilo se vytvořit upload token.");
    }

    return NextResponse.json(
      {
        ok: true,
        intake_id,
        original_name: originalName,
        mime,
        bytes,
        stored_path: `${BUCKET}/${uploadPath}`,
        created_at: new Date().toISOString(),
        upload_bucket: BUCKET,
        upload_path: uploadPath,
        upload_token: data.token,
      } satisfies IntakeResponse,
      { status: 200 }
    );
  } catch (cause) {
    return safeErrorJson({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Nepodařilo se připravit upload do Storage.",
      requestId,
      cause,
      logContext: { route: "/api/intake" },
    });
  }
}
