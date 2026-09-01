import { randomUUID } from "node:crypto";
import type { AiChecks } from "../leaflet/ai-checks.ts";
import type { AiProposal, FieldSources } from "../leaflet/field-source.ts";
import { emptyFieldSources } from "../leaflet/field-source.ts";
import type { LeafletPageExtractRequest, LeafletPageExtractResponse } from "../leaflet/extract-page-vision.ts";
import { parseLeafletProductsJson, type LeafletProduct } from "../leaflet/leaflet-product.ts";
import { getRetailerAdapter, type RetailerAdapter } from "../leaflet/retailer-adapter.ts";
import {
  runThreePassVerification,
  type ThreePassHooks,
} from "../leaflet/three-pass.ts";
import {
  createSupabasePdfPagesBackend,
  ensurePagesAfterDownload,
  type PdfPageRecord,
  type PdfPagesBackend,
} from "./pdf-pages.ts";
import type { PdfIntakeResult } from "./pdf-intake.ts";

export const PARSER_RUNS_TABLE = "leaflet_parser_runs";
export const OFFERS_STAGING_TABLE = "offers_staging";
export const IMPORT_BATCHES_TABLE = "import_batches";
export const AUTO_PARSER_PIPELINE = "leaflet-auto-parser";

export type ParserRunStatus = "running" | "parsed" | "failed" | "needs_review";

export type ParserRunRecord = {
  id: string;
  batch_id: string;
  page_id: string;
  page_no: number;
  store_id: string;
  adapter: string;
  status: ParserRunStatus;
  model?: string | null;
  error_message?: string | null;
  validation_errors?: string[] | null;
  raw_output?: string | null;
  offer_count?: number | null;
  created_at: string;
  finished_at?: string | null;
};

export type StagingOfferRecord = LeafletProduct & {
  id: string;
  batch_id: string;
  page_id: string;
  review_status: "pending" | "needs_review" | "approved" | "rejected";
  pipeline_version: string;
  ai_checks?: AiChecks | null;
  field_sources?: FieldSources | null;
  ai_proposal?: AiProposal | null;
  parser_run_id?: string | null;
  reviewed_at?: string | null;
};

export type PageParserBackend = {
  ensureImportBatch(input: {
    batch_id: string;
    store_id: string;
    source_url: string | null;
    storage_path: string;
  }): Promise<void>;
  insertParserRun(row: ParserRunRecord): Promise<ParserRunRecord>;
  updateParserRun(id: string, patch: Partial<ParserRunRecord>): Promise<ParserRunRecord>;
  insertStaging(rows: StagingOfferRecord[]): Promise<StagingOfferRecord[]>;
  updateStaging(id: string, patch: Partial<StagingOfferRecord>): Promise<StagingOfferRecord>;
  listStagingByPage(pageId: string): Promise<StagingOfferRecord[]>;
};

export type PageImageReadyContext = {
  archive: PdfIntakeResult;
  page: PdfPageRecord;
  image: Uint8Array;
};

export type ExtractPageFn = (req: LeafletPageExtractRequest) => Promise<LeafletPageExtractResponse>;

const IMPORT_RETAILERS = new Set(["lidl", "kaufland", "albert", "billa", "penny"]);

export function shouldAutoParsePage(status: PdfPageRecord["processing_status"]): boolean {
  return status === "rendered" || status === "queued" || status === "parsing";
}

export function createMemoryPageParserBackend(): PageParserBackend & {
  importBatches: Array<{ id: string; retailer: string }>;
  parserRuns: ParserRunRecord[];
  staging: StagingOfferRecord[];
} {
  const importBatches: Array<{ id: string; retailer: string }> = [];
  const parserRuns: ParserRunRecord[] = [];
  const staging: StagingOfferRecord[] = [];
  return {
    importBatches,
    parserRuns,
    staging,
    async ensureImportBatch(input) {
      if (importBatches.some((row) => row.id === input.batch_id)) return;
      importBatches.push({ id: input.batch_id, retailer: input.store_id });
    },
    async insertParserRun(row) {
      parserRuns.push({ ...row });
      return { ...row };
    },
    async updateParserRun(id, patch) {
      const current = parserRuns.find((row) => row.id === id);
      if (!current) throw new Error(`leaflet_parser_runs ${id} nebyl nalezen.`);
      Object.assign(current, patch);
      return { ...current };
    },
    async insertStaging(rows) {
      for (const row of rows) {
        if (row.review_status !== "pending" && row.review_status !== "needs_review") {
          throw new Error("Automatický parser nesmí ukládat schválené nabídky.");
        }
        staging.push({ ...row });
      }
      return rows.map((row) => ({ ...row }));
    },
    async updateStaging(id, patch) {
      const current = staging.find((row) => row.id === id);
      if (!current) throw new Error(`offers_staging ${id} nebyl nalezen.`);
      Object.assign(current, patch);
      return { ...current };
    },
    async listStagingByPage(pageId) {
      return staging.filter((row) => row.page_id === pageId).map((row) => ({ ...row }));
    },
  };
}

export function createSupabasePageParserBackend(supabase: any): PageParserBackend {
  return {
    async ensureImportBatch(input) {
      if (!IMPORT_RETAILERS.has(input.store_id)) {
        throw new Error(`import_batches nezná retailer "${input.store_id}".`);
      }
      const { error } = await supabase.from(IMPORT_BATCHES_TABLE).upsert(
        {
          id: input.batch_id,
          retailer: input.store_id,
          source_url: input.source_url,
          storage_path: input.storage_path,
          original_filename: "original.pdf",
          status: "processing",
          pipeline_version: AUTO_PARSER_PIPELINE,
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
      if (error) throw new Error(`import_batches: ${error.message}`);
    },
    async insertParserRun(row) {
      const { data, error } = await supabase.from(PARSER_RUNS_TABLE).insert(toParserRunRow(row)).select("*").single();
      if (error || !data) throw new Error(error?.message || "leaflet_parser_runs insert selhal.");
      return asParserRun(data);
    },
    async updateParserRun(id, patch) {
      const { data, error } = await supabase.from(PARSER_RUNS_TABLE).update(toParserRunPatch(patch)).eq("id", id).select("*").single();
      if (error || !data) throw new Error(error?.message || "leaflet_parser_runs update selhal.");
      return asParserRun(data);
    },
    async insertStaging(rows) {
      if (rows.some((row) => row.review_status !== "pending" && row.review_status !== "needs_review")) {
        throw new Error("Automatický parser nesmí ukládat schválené nabídky.");
      }
      if (!rows.length) return [];
      const { data, error } = await supabase.from(OFFERS_STAGING_TABLE).insert(rows.map(toStagingRow)).select("*");
      if (error) throw new Error(`offers_staging: ${error.message}`);
      return (data ?? []).map(asStaging);
    },
    async updateStaging(id, patch) {
      const { data, error } = await supabase.from(OFFERS_STAGING_TABLE).update(toStagingRowPatch(patch)).eq("id", id).select("*").single();
      if (error || !data) throw new Error(error?.message || "offers_staging update selhal.");
      return asStaging(data);
    },
    async listStagingByPage(pageId) {
      const { data, error } = await supabase.from(OFFERS_STAGING_TABLE).select("*").eq("page_id", pageId);
      if (error) throw new Error(`offers_staging list: ${error.message}`);
      return (data ?? []).map(asStaging);
    },
  };
}

export type PageParseOptions = {
  extract?: ExtractPageFn;
  threePass?: ThreePassHooks;
};

export async function runAutomaticPageParse(
  deps: { pages: Pick<PdfPagesBackend, "updatePage">; parser: PageParserBackend },
  ctx: PageImageReadyContext,
  extractOrOptions?: ExtractPageFn | PageParseOptions,
): Promise<{ run: ParserRunRecord; staged: StagingOfferRecord[] }> {
  const adapter = getRetailerAdapter(ctx.page.store_id);
  const request = toExtractRequest(ctx, adapter);
  const options = typeof extractOrOptions === "function" ? { extract: extractOrOptions } : extractOrOptions ?? {};
  const pass1Only = typeof extractOrOptions === "function";
  const run = await deps.parser.insertParserRun({
    id: randomUUID(),
    batch_id: ctx.page.batch_id,
    page_id: ctx.page.page_id,
    page_no: ctx.page.page_no,
    store_id: ctx.page.store_id,
    adapter: adapter.id,
    status: "running",
    created_at: new Date().toISOString(),
  });

  await deps.pages.updatePage(ctx.page.page_id, { processing_status: "queued", error_message: null });
  await deps.pages.updatePage(ctx.page.page_id, { processing_status: "parsing", error_message: null });

  try {
    await deps.parser.ensureImportBatch({
      batch_id: ctx.archive.batch_id,
      store_id: ctx.page.store_id,
      source_url: ctx.archive.source_url,
      storage_path: ctx.archive.pdf_storage_path || `leaflets/${ctx.page.store_id}/${ctx.page.batch_id}/original.pdf`,
    });

    if (pass1Only && options.extract) {
      const extracted = await options.extract(request);
      const parsed = parseLeafletProductsJson(extracted.raw, { fillMissingNullKeys: true });
      if (!parsed.ok) {
        return failValidation(deps, run.id, ctx, extracted.raw, extracted.model, parsed.errors);
      }
      const products = parsed.products.map((product) => stampPageIdentity(product, ctx.page));
      const staged = await deps.parser.insertStaging(products.map((product) => toStagingOffer(product, ctx.page)));
      return finishParsed(deps, run.id, ctx, extracted.model, extracted.raw, staged);
    }

    const threePass = await runThreePassVerification(request, ctx.image, {
      ...options.threePass,
      pass1: options.threePass?.pass1 ?? (options.extract
        ? async (req) => options.extract!(req)
        : undefined),
    });
    const staged = await deps.parser.insertStaging(
      threePass.products.map((item) =>
        toStagingOffer(stampPageIdentity(item.product, ctx.page), ctx.page, {
          review_status: item.review_status,
          ai_checks: item.ai_checks,
          pipeline_version: `${AUTO_PARSER_PIPELINE}-3pass`,
          parser_run_id: run.id,
        }),
      ),
    );
    return finishParsed(deps, run.id, ctx, threePass.pass1_model, threePass.pass1_raw, staged);
  } catch (error) {
    const validation = error as Error & { validation_errors?: string[]; raw?: string; model?: string };
    if (Array.isArray(validation.validation_errors)) {
      return failValidation(
        deps,
        run.id,
        ctx,
        validation.raw ?? "",
        validation.model ?? null,
        validation.validation_errors,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    const failed = await finishRun(deps.parser, run.id, {
      status: "failed",
      error_message: message.slice(0, 2000),
      validation_errors: null,
      offer_count: 0,
    });
    await deps.pages.updatePage(ctx.page.page_id, { processing_status: "failed", error_message: failed.error_message });
    return { run: failed, staged: [] };
  }
}

async function failValidation(
  deps: { pages: Pick<PdfPagesBackend, "updatePage">; parser: PageParserBackend },
  runId: string,
  ctx: PageImageReadyContext,
  raw: string,
  model: string | null,
  errors: string[],
) {
  const failed = await finishRun(deps.parser, runId, {
    status: "needs_review",
    model,
    error_message: errors.join("; ").slice(0, 2000),
    validation_errors: errors,
    raw_output: raw.slice(0, 20000),
    offer_count: 0,
  });
  await deps.pages.updatePage(ctx.page.page_id, {
    processing_status: "needs_review",
    error_message: failed.error_message,
  });
  return { run: failed, staged: [] as StagingOfferRecord[] };
}

async function finishParsed(
  deps: { pages: Pick<PdfPagesBackend, "updatePage">; parser: PageParserBackend },
  runId: string,
  ctx: PageImageReadyContext,
  model: string | null,
  raw: string,
  staged: StagingOfferRecord[],
) {
  const ok = await finishRun(deps.parser, runId, {
    status: "parsed",
    model,
    error_message: null,
    validation_errors: null,
    raw_output: raw.slice(0, 20000),
    offer_count: staged.length,
  });
  await deps.pages.updatePage(ctx.page.page_id, { processing_status: "parsed", error_message: null });
  return { run: ok, staged };
}

export async function ensurePagesAfterDownloadAndParse(
  supabase: any,
  archive: PdfIntakeResult,
  bytes: Uint8Array,
) {
  const pages = createSupabasePdfPagesBackend(supabase);
  const parser = createSupabasePageParserBackend(supabase);
  return ensurePagesAfterDownload(pages, archive, bytes, undefined, {
    onPageImage: (ctx) => runAutomaticPageParse({ pages, parser }, ctx),
  });
}

function toExtractRequest(ctx: PageImageReadyContext, adapter: RetailerAdapter): LeafletPageExtractRequest {
  return {
    batch_id: ctx.page.batch_id,
    page_id: ctx.page.page_id,
    page_no: ctx.page.page_no,
    store_id: ctx.page.store_id,
    adapter,
    image: ctx.image,
    mime: "image/png",
  };
}

function stampPageIdentity(product: LeafletProduct, page: PdfPageRecord): LeafletProduct {
  return {
    ...product,
    store_id: page.store_id,
    page_no: page.page_no,
    source_type: "leaflet",
  };
}

function toStagingOffer(
  product: LeafletProduct,
  page: PdfPageRecord,
    extras?: {
      review_status?: "pending" | "needs_review";
      ai_checks?: AiChecks | null;
      pipeline_version?: string;
      parser_run_id?: string | null;
    },
): StagingOfferRecord {
  return {
    ...product,
    id: randomUUID(),
    batch_id: page.batch_id,
    page_id: page.page_id,
    review_status: extras?.review_status ?? "pending",
    pipeline_version: extras?.pipeline_version ?? AUTO_PARSER_PIPELINE,
    ai_checks: extras?.ai_checks ?? null,
    field_sources: emptyFieldSources(),
    ai_proposal: null,
    parser_run_id: extras?.parser_run_id ?? null,
  };
}

async function finishRun(
  parser: PageParserBackend,
  id: string,
  patch: Partial<ParserRunRecord> & { status: ParserRunStatus },
): Promise<ParserRunRecord> {
  return parser.updateParserRun(id, { ...patch, finished_at: new Date().toISOString() });
}

function toParserRunRow(row: ParserRunRecord) {
  return {
    id: row.id,
    batch_id: row.batch_id,
    page_id: row.page_id,
    page_no: row.page_no,
    store_id: row.store_id,
    adapter: row.adapter,
    status: row.status,
    model: row.model ?? null,
    error_message: row.error_message ?? null,
    validation_errors: row.validation_errors ?? null,
    raw_output: row.raw_output ?? null,
    offer_count: row.offer_count ?? null,
    created_at: row.created_at,
    finished_at: row.finished_at ?? null,
  };
}

function toParserRunPatch(patch: Partial<ParserRunRecord>) {
  const out: Record<string, unknown> = {};
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.model !== undefined) out.model = patch.model;
  if (patch.error_message !== undefined) out.error_message = patch.error_message;
  if (patch.validation_errors !== undefined) out.validation_errors = patch.validation_errors;
  if (patch.raw_output !== undefined) out.raw_output = patch.raw_output;
  if (patch.offer_count !== undefined) out.offer_count = patch.offer_count;
  if (patch.finished_at !== undefined) out.finished_at = patch.finished_at;
  return out;
}

function asParserRun(row: any): ParserRunRecord {
  return {
    id: String(row.id),
    batch_id: String(row.batch_id),
    page_id: String(row.page_id),
    page_no: Number(row.page_no),
    store_id: String(row.store_id),
    adapter: String(row.adapter),
    status: row.status,
    model: row.model ?? null,
    error_message: row.error_message ?? null,
    validation_errors: Array.isArray(row.validation_errors) ? row.validation_errors : row.validation_errors ?? null,
    raw_output: row.raw_output ?? null,
    offer_count: row.offer_count == null ? null : Number(row.offer_count),
    created_at: String(row.created_at ?? ""),
    finished_at: row.finished_at ?? null,
  };
}

function toStagingRow(row: StagingOfferRecord) {
  return {
    id: row.id,
    batch_id: row.batch_id,
    page_id: row.page_id,
    page_no: row.page_no,
    store_id: row.store_id,
    source_type: row.source_type,
    valid_from: row.valid_from,
    valid_to: row.valid_to,
    valid_from_text: row.valid_from_text,
    valid_to_text: row.valid_to_text,
    extracted_name: row.extracted_name,
    price_total: row.price_total,
    currency: row.currency,
    pack_qty: row.pack_qty,
    pack_unit: row.pack_unit,
    pack_unit_qty: row.pack_unit_qty,
    price_standard: row.price_standard,
    typical_price_per_unit: row.typical_price_per_unit,
    price_with_loyalty_card: row.price_with_loyalty_card,
    has_loyalty_card_price: row.has_loyalty_card_price,
    notes: row.notes,
    brand: row.brand,
    category: row.category,
    raw_text_block: row.raw_text_block,
    review_status: row.review_status,
    pipeline_version: row.pipeline_version,
    ai_checks: row.ai_checks ?? null,
    field_sources: row.field_sources ?? null,
    ai_proposal: row.ai_proposal ?? null,
    parser_run_id: row.parser_run_id ?? null,
  };
}

function toStagingRowPatch(patch: Partial<StagingOfferRecord>) {
  const out: Record<string, unknown> = {};
  const keys: Array<keyof StagingOfferRecord> = [
    "extracted_name",
    "brand",
    "notes",
    "category",
    "raw_text_block",
    "price_total",
    "price_standard",
    "typical_price_per_unit",
    "price_with_loyalty_card",
    "has_loyalty_card_price",
    "pack_qty",
    "pack_unit",
    "pack_unit_qty",
    "valid_from",
    "valid_to",
    "valid_from_text",
    "valid_to_text",
    "review_status",
    "pipeline_version",
    "ai_checks",
    "field_sources",
    "ai_proposal",
    "parser_run_id",
    "reviewed_at",
  ];
  for (const key of keys) {
    if (patch[key] !== undefined) out[key] = patch[key];
  }
  return out;
}

function asStaging(row: any): StagingOfferRecord {
  return {
    id: String(row.id),
    batch_id: String(row.batch_id),
    page_id: String(row.page_id ?? ""),
    store_id: String(row.store_id),
    source_type: "leaflet",
    page_no: Number(row.page_no),
    valid_from: row.valid_from ?? null,
    valid_to: row.valid_to ?? null,
    valid_from_text: row.valid_from_text ?? null,
    valid_to_text: row.valid_to_text ?? null,
    extracted_name: row.extracted_name ?? null,
    price_total: row.price_total == null ? null : Number(row.price_total),
    currency: "CZK",
    pack_qty: row.pack_qty == null ? null : Number(row.pack_qty),
    pack_unit: row.pack_unit ?? null,
    pack_unit_qty: row.pack_unit_qty == null ? null : Number(row.pack_unit_qty),
    price_standard: row.price_standard == null ? null : Number(row.price_standard),
    typical_price_per_unit: row.typical_price_per_unit == null ? null : Number(row.typical_price_per_unit),
    price_with_loyalty_card: row.price_with_loyalty_card == null ? null : Number(row.price_with_loyalty_card),
    has_loyalty_card_price: row.has_loyalty_card_price ?? null,
    notes: row.notes ?? null,
    brand: row.brand ?? null,
    category: row.category ?? null,
    raw_text_block: row.raw_text_block ?? null,
    review_status: asHumanReviewStatus(row.review_status),
    pipeline_version: String(row.pipeline_version ?? AUTO_PARSER_PIPELINE),
    ai_checks: row.ai_checks ?? null,
    field_sources: row.field_sources ?? null,
    ai_proposal: row.ai_proposal ?? null,
    parser_run_id: row.parser_run_id ?? null,
    reviewed_at: row.reviewed_at ?? null,
  };
}

function asHumanReviewStatus(value: unknown): StagingOfferRecord["review_status"] {
  if (value === "approved" || value === "rejected" || value === "needs_review" || value === "pending") return value;
  return "pending";
}
