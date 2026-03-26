import { NextResponse } from "next/server";
import { listPrompts, upsertPrompt } from "@/lib/prompts/store";

export async function GET() {
  const prompts = await listPrompts();
  return NextResponse.json({ ok: true, prompts });
}

export async function POST(req: Request) {
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
    body = (await req.json()) as any;
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

