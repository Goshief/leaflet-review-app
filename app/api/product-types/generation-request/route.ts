import { NextRequest, NextResponse } from "next/server";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  createOrReuseGenerationRequest,
  listGenerationRequests,
  parseGenerationRequestUpdateBody,
  parseGenerationRequestBody,
  updateGenerationRequestLifecycle,
  type GenerationRequestBody,
  type GenerationRequestUpdateBody,
} from "@/lib/product-types/generation-request-route-logic";
import { isValidImageKey } from "@/lib/product-types/image-keys";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Supabase není nakonfigurované. Doplň NEXT_PUBLIC_SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY do .env.local.",
      },
      { status: 500 }
    );
  }
  const result = await listGenerationRequests(supabase, 500);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, requests: result.requests });
}

export async function POST(req: NextRequest) {
  const requestId = makeRequestId();
  try {
    let body: GenerationRequestBody;
    try {
      body = (await req.json()) as GenerationRequestBody;
    } catch {
      return NextResponse.json({ ok: false, error: "Očekávám JSON body" }, { status: 400 });
    }

    let parsed;
    try {
      parsed = parseGenerationRequestBody(body);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Neplatný generation request" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Supabase není nakonfigurované. Doplň NEXT_PUBLIC_SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY do .env.local.",
        },
        { status: 500 }
      );
    }

    const result = await createOrReuseGenerationRequest(supabase, parsed);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      created: result.created,
      request: result.request,
      message: result.created
        ? "Požadavek na generování byl uložen."
        : "Požadavek už existuje a zůstává pending.",
    });
  } catch (e) {
    return safeErrorJson({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Požadavek na generování obrázku selhal.",
      requestId,
      cause: e,
      logContext: { route: "/api/product-types/generation-request" },
    });
  }
}

export async function PATCH(req: NextRequest) {
  const requestId = makeRequestId();
  try {
    let body: GenerationRequestUpdateBody;
    try {
      body = (await req.json()) as GenerationRequestUpdateBody;
    } catch {
      return NextResponse.json({ ok: false, error: "Očekávám JSON body" }, { status: 400 });
    }

    let parsed;
    try {
      parsed = parseGenerationRequestUpdateBody(body);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Neplatný update request" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Supabase není nakonfigurované. Doplň NEXT_PUBLIC_SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY do .env.local.",
        },
        { status: 500 }
      );
    }

    const result = await updateGenerationRequestLifecycle(supabase, parsed, { isValidImageKey });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, request: result.request });
  } catch (e) {
    return safeErrorJson({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Aktualizace požadavku na generování obrázku selhala.",
      requestId,
      cause: e,
      logContext: { route: "/api/product-types/generation-request", method: "PATCH" },
    });
  }
}

