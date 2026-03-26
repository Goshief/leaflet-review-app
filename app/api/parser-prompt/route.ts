import { NextResponse } from "next/server";

import { getSystemPromptLidlCzStrict } from "@/lib/lidl-parser";
import { getPrompt, upsertPrompt } from "@/lib/prompts/store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const store = (url.searchParams.get("store_id") ?? "lidl").toLowerCase();

  // 1) Pokud existuje prompt v editable store, vrať ho.
  const fromStore = await getPrompt(store);
  if (fromStore) {
    return NextResponse.json({
      ok: true,
      store_id: fromStore.store_id,
      prompt: fromStore.prompt,
      title: fromStore.title,
      subtitle: fromStore.subtitle,
      updated_at: fromStore.updated_at,
      updated_by: fromStore.updated_by ?? null,
      version: fromStore.version ?? 1,
      config: fromStore.config ?? null,
      history_count: Array.isArray(fromStore.history) ? fromStore.history.length : 0,
    });
  }

  // 2) Fallback: Lidl prompt ze souboru v repo (dokud si ho neupravíš v UI).
  if (store === "lidl") {
    const prompt = getSystemPromptLidlCzStrict();
    return NextResponse.json({
      ok: true,
      store_id: "lidl",
      prompt,
      title: "Lidl CZ — striktní staging parser",
      subtitle: "Produkty z jedné stránky → JSON schéma (bez domýšlení).",
      updated_at: null,
    });
  }

  return NextResponse.json(
    { error: `Parser pro store_id "${store}" zatím není přidaný.` },
    { status: 404 }
  );
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
    return NextResponse.json({ ok: true, ...rec });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Uložení selhalo" },
      { status: 400 }
    );
  }
}

