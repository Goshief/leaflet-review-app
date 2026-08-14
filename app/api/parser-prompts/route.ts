import { NextResponse } from "next/server";
import { listPrompts, upsertPrompt } from "@/lib/prompts/store";
import { requireAdminApi, requireOperatorApi } from "@/lib/auth/guards";

export async function GET() {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const prompts = await listPrompts();
  return NextResponse.json({ ok: true, prompts });
}

export async function POST(req: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: {
    store_id?: string;
    title?: string;
    subtitle?: string;
    prompt?: string;
    updated_by?: string | null;
    config?: {
      default_extract?: "ocr" | "vision" | "local";
      enabled?: boolean;
      notes?: string;
    };
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Očekávám JSON body" }, { status: 400 });
  }
  try {
    const rec = await upsertPrompt({
      store_id: body.store_id ?? "",
      title: body.title ?? "",
      subtitle: body.subtitle ?? "",
      prompt: body.prompt ?? "",
      updated_by: body.updated_by ?? null,
      config: body.config,
    });
    return NextResponse.json({ ok: true, prompt: rec });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Uložení selhalo" },
      { status: 400 }
    );
  }
}

