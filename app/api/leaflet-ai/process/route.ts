import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapOffersForImportRun, type MapOfferInput, type RowStatus } from "@/lib/import-run/map-offers";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_BUCKET = "leaflet-intake";
const MODEL = process.env.LEAFLET_AI_MODEL?.trim() || "gpt-5.6";

type ProcessBody = {
  bucket?: string;
  path?: string;
  retailer?: string;
  source_url?: string | null;
  page?: number | null;
  dry_run?: boolean;
};

type AiOffer = MapOfferInput & {
  page_no: number;
  confidence: number | null;
};

type VerifiedOffer = AiOffer & {
  status: "approved" | "quarantine";
  verification_reason: string | null;
};

type State = {
  version: 1;
  bucket: string;
  path: string;
  retailer: string;
  source_url: string | null;
  import_id: string;
  openai_file_id: string;
  page_count: number;
  next_page: number;
  processed_pages: number[];
  completed: boolean;
  created_at: string;
  updated_at: string;
};

const OFFER_PROPERTIES = {
  store_id: { type: ["string", "null"] },
  source_type: { type: ["string", "null"] },
  page_no: { type: "integer" },
  valid_from: { type: ["string", "null"] },
  valid_to: { type: ["string", "null"] },
  extracted_name: { type: ["string", "null"] },
  price_total: { type: ["number", "null"] },
  currency: { type: ["string", "null"] },
  pack_qty: { type: ["number", "null"] },
  pack_unit: { type: ["string", "null"] },
  pack_unit_qty: { type: ["number", "null"] },
  price_standard: { type: ["number", "null"] },
  typical_price_per_unit: { type: ["number", "null"] },
  price_with_loyalty_card: { type: ["number", "null"] },
  has_loyalty_card_price: { type: ["boolean", "null"] },
  notes: { type: ["string", "null"] },
  brand: { type: ["string", "null"] },
  category: { type: ["string", "null"] },
  confidence: { type: ["number", "null"] },
} as const;

const OFFER_REQUIRED = Object.keys(OFFER_PROPERTIES);

function statePath(pdfPath: string) {
  return `${pdfPath}.ai-state.json`;
}

async function authorize(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return null;
  const gate = await requireOperatorApi();
  return gate.ok ? null : gate.response;
}

async function openAiFetch(path: string, init: RequestInit) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY není nastavený.");
  const res = await fetch(`https://api.openai.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 1200)}`);
  }
  return res;
}

async function uploadPdfToOpenAI(bytes: Uint8Array, filename: string) {
  const fd = new FormData();
  fd.append("purpose", "user_data");
  fd.append("file", new Blob([bytes], { type: "application/pdf" }), filename);
  const res = await openAiFetch("/v1/files", { method: "POST", body: fd });
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("OpenAI nevrátil file_id.");
  return data.id;
}

async function deleteOpenAIFile(fileId: string) {
  try {
    await openAiFetch(`/v1/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  } catch (e) {
    console.warn("[leaflet-ai] OpenAI file cleanup failed", e);
  }
}

function responseOutputText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text;
  const parts: string[] = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    if (item?.type !== "message") continue;
    for (const c of Array.isArray(item?.content) ? item.content : []) {
      if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\n");
}

async function structuredResponse(args: {
  fileId: string;
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
}) {
  const res = await openAiFetch("/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: args.prompt },
            { type: "input_file", file_id: args.fileId },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: args.schemaName,
          strict: true,
          schema: args.schema,
        },
      },
    }),
  });
  const data = await res.json();
  const text = responseOutputText(data);
  if (!text) throw new Error("OpenAI nevrátil strukturovaný výstup.");
  return JSON.parse(text);
}

async function extractPage(fileId: string, retailer: string, page: number): Promise<AiOffer[]> {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      offers: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: OFFER_PROPERTIES,
          required: OFFER_REQUIRED,
        },
      },
    },
    required: ["offers"],
  };

  const result = await structuredResponse({
    fileId,
    schemaName: "leaflet_page_extraction",
    schema,
    prompt: [
      `Jsi vizuální kontrolor českých akčních letáků. Zpracuj VÝHRADNĚ stránku číslo ${page} přiloženého PDF.`,
      `Obchod je ${retailer}. Neprováděj OCR pipeline; obsah stránky sám vizuálně interpretuj z PDF.`,
      "Najdi všechny jednotlivé produktové nabídky na této stránce. Každý samostatně naceněný produkt je jeden řádek.",
      "Nevymýšlej hodnoty, které na stránce nejsou. Pokud si nejsi jistý, použij null a sniž confidence.",
      "price_total = skutečná nabídková cena produktu, price_standard = přeškrtnutá/původní cena, pokud je uvedena.",
      "Pokud je cena pouze s věrnostní kartou, nastav has_loyalty_card_price=true a price_with_loyalty_card. Jinak false nebo null.",
      "Datum platnosti zapisuj YYYY-MM-DD pouze pokud je z letáku jednoznačné. Měna CZK.",
      `store_id musí být '${retailer}', source_type musí být 'leaflet', page_no musí být ${page}.`,
      "category používej stručnou obecnou českou kategorii. notes jen pro důležitou podmínku akce nebo nejasnost.",
      "confidence je 0 až 1 a vyjadřuje jistotu správného přečtení celého řádku.",
    ].join("\n"),
  });

  return (Array.isArray(result?.offers) ? result.offers : []) as AiOffer[];
}

async function verifyPage(
  fileId: string,
  retailer: string,
  page: number,
  extraction: AiOffer[]
): Promise<VerifiedOffer[]> {
  const verifiedProperties = {
    ...OFFER_PROPERTIES,
    status: { type: "string", enum: ["approved", "quarantine"] },
    verification_reason: { type: ["string", "null"] },
  } as const;
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      offers: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: verifiedProperties,
          required: Object.keys(verifiedProperties),
        },
      },
    },
    required: ["offers"],
  };

  const result = await structuredResponse({
    fileId,
    schemaName: "leaflet_page_verification",
    schema,
    prompt: [
      `Proveď DRUHOU nezávislou vizuální kontrolu stránky ${page} PDF letáku obchodu ${retailer}.`,
      "Níže je první přepis. Porovnej KAŽDÝ produkt znovu přímo s původní stránkou a oprav chyby.",
      "Zároveň doplň produkt, který první průchod přehlédl, a odstraň položku, která na stránce ve skutečnosti není.",
      "Status approved dej jen tehdy, když jsou bezpečně ověřené minimálně název produktu, nabídková cena a platnost nabídky.",
      "Pokud je zásadní údaj nečitelný, sporný nebo si nejsi jistý správným přiřazením ceny k produktu, status musí být quarantine.",
      `store_id='${retailer}', source_type='leaflet', page_no=${page}, currency='CZK'.`,
      "První přepis:",
      JSON.stringify(extraction),
    ].join("\n"),
  });

  return (Array.isArray(result?.offers) ? result.offers : []) as VerifiedOffer[];
}

async function readState(supabase: any, bucket: string, pdfPath: string): Promise<State | null> {
  const { data, error } = await supabase.storage.from(bucket).download(statePath(pdfPath));
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as State;
  } catch {
    return null;
  }
}

async function writeState(supabase: any, state: State) {
  state.updated_at = new Date().toISOString();
  const { error } = await supabase.storage.from(state.bucket).upload(
    statePath(state.path),
    new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    { contentType: "application/json", upsert: true }
  );
  if (error) throw new Error(`Nelze uložit AI stav: ${error.message}`);
}

async function initializeState(args: {
  supabase: any;
  bucket: string;
  path: string;
  retailer: string;
  sourceUrl: string | null;
}): Promise<State> {
  const { data: pdfBlob, error } = await args.supabase.storage.from(args.bucket).download(args.path);
  if (error || !pdfBlob) throw new Error(error?.message || "PDF ve Storage nebylo nalezeno.");
  const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
  const doc = await getDocument({ data: bytes, disableWorker: true }).promise;
  const pageCount = doc.numPages;
  await doc.destroy();

  const openaiFileId = await uploadPdfToOpenAI(bytes, args.path.split("/").pop() || "leaflet.pdf");
  const { data: imp, error: impError } = await args.supabase
    .from("imports")
    .insert({
      source_type: "leaflet",
      source_url: args.sourceUrl,
      note: `ai_page_pipeline | retailer:${args.retailer} | storage:${args.bucket}/${args.path}`,
      import_batch_key: `ai:${args.bucket}:${args.path}`,
      import_contract_version: "leaflet-ai-v1",
      import_contract_snapshot: { retailer: args.retailer, bucket: args.bucket, path: args.path, model: MODEL },
    })
    .select("id")
    .single();
  if (impError || !imp?.id) {
    await deleteOpenAIFile(openaiFileId);
    throw new Error(impError?.message || "Nepodařilo se vytvořit import.");
  }

  const now = new Date().toISOString();
  const state: State = {
    version: 1,
    bucket: args.bucket,
    path: args.path,
    retailer: args.retailer,
    source_url: args.sourceUrl,
    import_id: imp.id,
    openai_file_id: openaiFileId,
    page_count: pageCount,
    next_page: 1,
    processed_pages: [],
    completed: false,
    created_at: now,
    updated_at: now,
  };
  await writeState(args.supabase, state);
  return state;
}

export async function POST(req: NextRequest) {
  const unauthorized = await authorize(req);
  if (unauthorized) return unauthorized;

  let body: ProcessBody;
  try {
    body = (await req.json()) as ProcessBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Očekávám JSON body." }, { status: 400 });
  }

  const path = body.path?.trim();
  const bucket = body.bucket?.trim() || DEFAULT_BUCKET;
  const retailer = body.retailer?.trim().toLowerCase();
  if (!path || !retailer) {
    return NextResponse.json({ ok: false, error: "Chybí path nebo retailer." }, { status: 400 });
  }
  if (!path.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ ok: false, error: "AI pipeline přijímá pouze PDF." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase admin není nakonfigurovaný." }, { status: 503 });

  try {
    let state = await readState(supabase, bucket, path);
    if (!state) {
      state = await initializeState({
        supabase,
        bucket,
        path,
        retailer,
        sourceUrl: body.source_url ?? null,
      });
    }

    if (state.completed) {
      return NextResponse.json({ ok: true, completed: true, state });
    }

    const page = body.page ?? state.next_page;
    if (!Number.isInteger(page) || page < 1 || page > state.page_count) {
      return NextResponse.json({ ok: false, error: `page musí být 1 až ${state.page_count}.` }, { status: 400 });
    }
    if (state.processed_pages.includes(page)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "page_already_processed", page, state });
    }

    const extraction = await extractPage(state.openai_file_id, state.retailer, page);
    const verified = await verifyPage(state.openai_file_id, state.retailer, page, extraction);

    const statuses: Record<number, RowStatus> = {};
    verified.forEach((o, i) => {
      statuses[i] = o.status === "approved" ? "approved" : "quarantine";
      if (o.verification_reason) {
        o.notes = [o.notes, `AI verification: ${o.verification_reason}`].filter(Boolean).join(" | ");
      }
    });

    const mapped = mapOffersForImportRun({
      offers: verified,
      row_status: statuses,
      meta: {
        import_id: state.import_id,
        source_type: "leaflet",
        source_url: state.source_url,
        today_iso: new Date().toISOString().slice(0, 10),
      },
    });

    if (!body.dry_run) {
      if (mapped.rawRows.length) {
        const { error } = await supabase.from("offers_raw").insert(mapped.rawRows);
        if (error) throw new Error(`offers_raw insert: ${error.message}`);
      }
      if (mapped.quarantineRows.length) {
        const { error } = await supabase.from("offers_quarantine").insert(mapped.quarantineRows);
        if (error) throw new Error(`offers_quarantine insert: ${error.message}`);
      }

      state.processed_pages = [...state.processed_pages, page].sort((a, b) => a - b);
      state.next_page = Math.min(state.page_count + 1, page + 1);
      state.completed = state.processed_pages.length >= state.page_count;
      await writeState(supabase, state);
      if (state.completed) await deleteOpenAIFile(state.openai_file_id);
    }

    return NextResponse.json({
      ok: true,
      dry_run: Boolean(body.dry_run),
      model: MODEL,
      page,
      page_count: state.page_count,
      first_pass_count: extraction.length,
      verified_count: verified.length,
      approved_count: mapped.rawRows.length,
      quarantine_count: mapped.quarantineRows.length,
      required_field_errors: mapped.requiredFieldErrors,
      completed: body.dry_run ? false : state.completed,
      next_page: body.dry_run ? page : state.next_page,
      verified_offers: body.dry_run ? verified : undefined,
    });
  } catch (e) {
    console.error("[leaflet-ai] processing failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
