import { parseLidlPageOffersJson } from "@/lib/lidl-parser";
import { NextRequest, NextResponse } from "next/server";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";

export const runtime = "nodejs";
export const maxDuration = 120;

type NormalizeRequest = {
  /** Výstup z /api/extract (heuristika+OCR) nebo cokoliv podobného. */
  blocks: Array<{
    page_no?: number | null;
    source_url?: string | null;
    /** Surový text bloku okolo ceny (nebo cokoliv). */
    text?: string;
    /** Pomocné hinty (volitelné). */
    price_total?: number | null;
    currency?: "CZK";
  }>;
  /** Přepsat page_no, pokud chceš. */
  page_no?: number | null;
  source_url?: string | null;
};

type NormalizeResponse =
  | {
      ok: true;
      mode: "normalize";
      offers: unknown[];
      model: string;
      raw_model_output: string;
    }
  | { ok: false; error: string; detail?: string };

function buildPrompt(input: NormalizeRequest): string {
  const lines: string[] = [];
  lines.push("Jsi parser pro Lidl CZ letáky.");
  lines.push("Dostáváš OCR bloky kolem cen (text).");
  lines.push("Úkol: vytvořit JSON pole produktů ve striktním schématu Lidl staging řádku.");
  lines.push("");
  lines.push("PRAVIDLA:");
  lines.push("- Vrať POUZE validní JSON pole. Nic jiného.");
  lines.push("- Žádný markdown, žádný text před/za JSON.");
  lines.push("- Nepřidávej žádná další pole mimo schéma.");
  lines.push("- Nejasné hodnoty dávej null (ale produkt nevynechávej jen kvůli nejasnosti).");
  lines.push("- VÝSTUP MUSÍ MÍT STEJNÝ POČET OBJEKTŮ jako vstupní bloky. Každý blok = 1 objekt.");
  lines.push("- Každý objekt musí odpovídat konkrétnímu #indexu ve vstupu: raw_text_block musí obsahovat původní text bloku (#).");
  lines.push("- currency vždy \"CZK\".");
  lines.push("- Čísla vrať jako number (žádné uvozovky). Decimální hodnoty používej s tečkou.");
  lines.push("");
  lines.push("SCHÉMA (přesně tyto klíče, žádné jiné):");
  lines.push(
    `[{"store_id":"lidl","source_type":"leaflet","page_no":null,"valid_from":null,"valid_to":null,"valid_from_text":null,"valid_to_text":null,"extracted_name":null,"price_total":null,"currency":"CZK","pack_qty":null,"pack_unit":null,"pack_unit_qty":null,"price_standard":null,"typical_price_per_unit":null,"price_with_loyalty_card":null,"has_loyalty_card_price":false,"notes":null,"brand":null,"category":null,"raw_text_block":null}]`
  );
  lines.push("");
  lines.push("DŮLEŽITÉ:");
  lines.push("- has_loyalty_card_price: dej false pokud není jasné Lidl Plus.");
  lines.push("- raw_text_block: dej krátký úryvek OCR textu, ze kterého jsi bral data.");
  lines.push("- category nech většinou null (neklasifikuj, pokud to není explicitně dané).");
  lines.push("");
  lines.push("VSTUP (OCR bloky):");
  input.blocks.slice(0, 80).forEach((b, i) => {
    const t = (b.text ?? "").replace(/\s+/g, " ").trim();
    lines.push(
      `#${i + 1} price_total=${b.price_total ?? "null"} text="${t.slice(0, 220)}"`
    );
  });
  return lines.join("\n");
}

async function callOllama(model: string, prompt: string): Promise<string> {
  const base = process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
  const url = `${base.replace(/\/$/, "")}/api/chat`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Odpovídej pouze validním JSON polem podle daného schématu. Bez markdownu.",
          },
          { role: "user", content: prompt },
        ],
        stream: false,
        options: { temperature: 0 },
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Nelze se připojit na Ollamu (${base}). Spusť Ollamu (musí běžet lokálně na 11434). Detail: ${msg}`
    );
  }
  const raw = await res.text();
  if (!res.ok) {
    return Promise.reject(
      new Error(`Ollama (HTTP ${res.status}): ${raw.slice(0, 800)}`)
    );
  }
  try {
    const j = JSON.parse(raw) as { message?: { content?: string } };
    const out = (j.message?.content ?? "").trim();
    if (!out) throw new Error("prázdná odpověď");
    return out;
  } catch {
    throw new Error(`Ollama: nečekaná odpověď: ${raw.slice(0, 800)}`);
  }
}

export async function POST(req: NextRequest) {
  const requestId = makeRequestId();
  try {
    let body: NormalizeRequest;
    try {
      body = (await req.json()) as NormalizeRequest;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Očekávám JSON body" } satisfies NormalizeResponse,
        { status: 400 }
      );
    }
    if (!Array.isArray(body.blocks) || body.blocks.length === 0) {
      return NextResponse.json(
        { ok: false, error: "body.blocks musí být neprázdné pole" } satisfies NormalizeResponse,
        { status: 400 }
      );
    }

    const model = process.env.OLLAMA_MODEL?.trim() || "qwen2.5:7b-instruct";
    const prompt = buildPrompt(body);

    let out: string;
    try {
      out = await callOllama(model, prompt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ollama volání selhalo";
      return NextResponse.json(
        {
          ok: false,
          error:
            "Normalize selhalo (Ollama). Spusť Ollamu a stáhni model, nebo nastav OLLAMA_BASE_URL/OLLAMA_MODEL.",
          detail: msg,
        } satisfies NormalizeResponse,
        { status: 502 }
      );
    }

    const parsed = parseLidlPageOffersJson(out, { fillMissingNullKeys: true });
    if (!parsed.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "Validace JSON selhala",
          detail: parsed.errors.slice(0, 10).join("; "),
        } satisfies NormalizeResponse,
        { status: 422 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        mode: "normalize",
        offers: parsed.offers,
        model: `ollama/${model}`,
        raw_model_output: out,
      } satisfies NormalizeResponse,
      { status: 200 }
    );
  } catch (e) {
    return safeErrorJson({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Normalizace selhala.",
      requestId,
      cause: e,
      logContext: { route: "/api/normalize" },
    });
  }
}

