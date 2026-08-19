import { NextRequest, NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapOffersForImportRun, type MapOfferInput, type RowStatus } from "@/lib/import-run/map-offers";
import { runOcrPipeline, type OcrWord } from "@/lib/ocr";

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_BUCKET = "leaflet-intake";
const MODEL = "local-pdf-text + OCR heuristics";

type ProcessBody = {
  bucket?: string;
  path?: string;
  retailer?: string;
  source_url?: string | null;
  page?: number | null;
  dry_run?: boolean;
};

type VerifiedOffer = MapOfferInput & {
  page_no: number;
  confidence: number | null;
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
    { contentType: "application/json", upsert: true },
  );
  if (error) throw new Error(`Nelze uložit stav zpracování: ${error.message}`);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function findValidity(text: string, path: string): { valid_from: string | null; valid_to: string | null } {
  const filenameMatch = path.match(/(\d{2})-(\d{2})-(\d{4})-(\d{2})-(\d{2})-(\d{4})/);
  if (filenameMatch) {
    return {
      valid_from: `${filenameMatch[3]}-${filenameMatch[2]}-${filenameMatch[1]}`,
      valid_to: `${filenameMatch[6]}-${filenameMatch[5]}-${filenameMatch[4]}`,
    };
  }

  const year = new Date().getFullYear();
  const range = text.match(/(\d{1,2})\.\s*(\d{1,2})\.?\s*(?:-|–|—)\s*(\d{1,2})\.\s*(\d{1,2})\.?/);
  if (range) {
    return {
      valid_from: isoDate(year, Number(range[2]), Number(range[1])),
      valid_to: isoDate(year, Number(range[4]), Number(range[3])),
    };
  }
  return { valid_from: null, valid_to: null };
}

async function loadPdfPage(bytes: Uint8Array, pageNo: number) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  try {
    if (pageNo < 1 || pageNo > doc.numPages) {
      throw new Error(`Stránka musí být 1 až ${doc.numPages}.`);
    }
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    const words: OcrWord[] = [];
    const textParts: string[] = [];

    for (const raw of content.items) {
      if (!("str" in raw) || typeof raw.str !== "string") continue;
      const text = raw.str.trim();
      if (!text) continue;
      const transform = Array.isArray(raw.transform) ? raw.transform : [1, 0, 0, 1, 0, 0];
      const x = Number(transform[4] ?? 0);
      const y = Number(transform[5] ?? 0);
      const w = Math.max(1, Number(raw.width ?? text.length * 5));
      const h = Math.max(1, Number(raw.height ?? Math.abs(Number(transform[3] ?? 10))));
      words.push({ text, x, y, w, h });
      textParts.push(text);
    }

    return { pageCount: doc.numPages, words, text: textParts.join(" ") };
  } finally {
    await doc.destroy();
  }
}

async function ensureImport(args: {
  supabase: any;
  bucket: string;
  path: string;
  retailer: string;
  sourceUrl: string | null;
}) {
  const batchKey = `local-ocr:${args.bucket}:${args.path}`;
  const { data: existing, error: lookupError } = await args.supabase
    .from("imports")
    .select("id")
    .eq("import_batch_key", batchKey)
    .maybeSingle();
  if (lookupError) throw new Error(`Nelze dohledat import: ${lookupError.message}`);
  if (typeof existing?.id === "string") return existing.id;

  const { data: created, error } = await args.supabase
    .from("imports")
    .insert({
      source_type: "leaflet",
      source_url: args.sourceUrl,
      note: `local_ocr_page_pipeline | retailer:${args.retailer} | storage:${args.bucket}/${args.path}`,
      import_batch_key: batchKey,
      import_contract_version: "leaflet-local-ocr-v1",
      import_contract_snapshot: {
        retailer: args.retailer,
        bucket: args.bucket,
        path: args.path,
        model: MODEL,
      },
    })
    .select("id")
    .single();
  if (error || typeof created?.id !== "string") {
    throw new Error(error?.message || "Nepodařilo se vytvořit import.");
  }
  return created.id;
}

function toVerifiedOffers(
  retailer: string,
  pageNo: number,
  path: string,
  pageText: string,
  pipelineOffers: Array<Record<string, any>>,
): VerifiedOffer[] {
  const validity = findValidity(pageText, path);
  return pipelineOffers.map((offer) => {
    const name = typeof offer.extracted_name === "string" && offer.extracted_name.trim()
      ? offer.extracted_name.trim()
      : null;
    const price = typeof offer.price_total === "number" && Number.isFinite(offer.price_total)
      ? offer.price_total
      : null;
    const hasMinimumFields = Boolean(name && price != null);
    const confidence = hasMinimumFields ? 0.45 : 0.2;
    return {
      store_id: retailer,
      source_type: "leaflet",
      page_no: pageNo,
      valid_from: validity.valid_from,
      valid_to: validity.valid_to,
      extracted_name: name,
      price_total: price,
      currency: "CZK",
      pack_qty: offer.pack_qty ?? null,
      pack_unit: offer.pack_unit ?? null,
      pack_unit_qty: offer.pack_unit_qty ?? null,
      price_standard: offer.price_standard ?? null,
      typical_price_per_unit: offer.typical_price_per_unit ?? null,
      price_with_loyalty_card: offer.price_with_loyalty_card ?? null,
      has_loyalty_card_price: offer.has_loyalty_card_price ?? false,
      notes: [offer.notes, "Lokální heuristika je pouze kandidát. Nic se automaticky neschvaluje."].filter(Boolean).join(" | "),
      brand: offer.brand ?? null,
      category: offer.category ?? null,
      confidence,
      status: "quarantine",
      verification_reason: hasMinimumFields
        ? "Kandidát byl nalezen lokální heuristikou, ale vazba produktu a ceny není dostatečně ověřená. Vyžaduje ruční kontrolu."
        : "Chybí jednoznačně doložený název nebo cena. Bez ruční kontroly se nesmí zapsat jako nabídka.",
    };
  });
}

export async function POST(req: NextRequest) {
  const unauthorized = await authorize(req);
  if (unauthorized) return unauthorized;

  let body: ProcessBody;
  try {
    body = await req.json() as ProcessBody;
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
    return NextResponse.json({ ok: false, error: "Lokální OCR pipeline přijímá celé PDF." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase admin není nakonfigurovaný." }, { status: 503 });
  }

  try {
    const { data: pdfBlob, error: pdfError } = await supabase.storage.from(bucket).download(path);
    if (pdfError || !pdfBlob) throw new Error(pdfError?.message || "PDF ve Storage nebylo nalezeno.");
    const bytes = new Uint8Array(await pdfBlob.arrayBuffer());

    let state = await readState(supabase, bucket, path);
    const requestedPage = body.page ?? state?.next_page ?? 1;
    if (!Number.isInteger(requestedPage) || requestedPage < 1) {
      return NextResponse.json({ ok: false, error: "Neplatné číslo stránky." }, { status: 400 });
    }

    const pdfPage = await loadPdfPage(bytes, requestedPage);
    if (!pdfPage.words.length) {
      throw new Error("Tahle stránka PDF nemá čitelnou textovou vrstvu. Pro čistě obrázkový leták bude potřeba převod stránky na obrázek pro Tesseract.");
    }

    if (!state) {
      const importId = await ensureImport({
        supabase,
        bucket,
        path,
        retailer,
        sourceUrl: body.source_url ?? null,
      });
      const now = new Date().toISOString();
      state = {
        version: 1,
        bucket,
        path,
        retailer,
        source_url: body.source_url ?? null,
        import_id: importId,
        openai_file_id: "",
        page_count: pdfPage.pageCount,
        next_page: 1,
        processed_pages: [],
        completed: false,
        created_at: now,
        updated_at: now,
      };
      await writeState(supabase, state);
    } else if (state.page_count !== pdfPage.pageCount) {
      state.page_count = pdfPage.pageCount;
      await writeState(supabase, state);
    }

    const page = requestedPage;
    if (page > state.page_count) {
      return NextResponse.json({ ok: false, error: `Stránka musí být 1 až ${state.page_count}.` }, { status: 400 });
    }
    if (state.processed_pages.includes(page)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "page_already_processed", page, state });
    }

    const pipeline = runOcrPipeline(pdfPage.words, page);
    const verified = toVerifiedOffers(retailer, page, path, pdfPage.text, pipeline.offers as Array<Record<string, any>>);
    const statuses: Record<number, RowStatus> = {};
    verified.forEach((offer, index) => {
      statuses[index] = offer.status === "approved" ? "approved" : "quarantine";
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
    }

    return NextResponse.json({
      ok: true,
      dry_run: Boolean(body.dry_run),
      model: MODEL,
      page,
      page_count: state.page_count,
      first_pass_count: pipeline.offers.length,
      verified_count: verified.length,
      approved_count: mapped.rawRows.length,
      quarantine_count: mapped.quarantineRows.length,
      required_field_errors: mapped.requiredFieldErrors,
      completed: body.dry_run ? false : state.completed,
      next_page: body.dry_run ? page : state.next_page,
      verified_offers: body.dry_run ? verified : undefined,
      ocr_word_count: pipeline.ocr_words.length,
      price_anchor_count: pipeline.price_anchors.length,
    });
  } catch (error) {
    console.error("[leaflet-local-ocr] processing failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
