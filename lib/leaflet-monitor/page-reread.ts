import { randomUUID } from "node:crypto";
import { ADAPTER_VERSION, PARSER_VERSION } from "../leaflet/parser-versions.ts";
import { emptyFieldSources, mergeKeepingHumanFields, type AiProposal, type FieldSources } from "../leaflet/field-source.ts";
import { matchExistingToDiscovered } from "../leaflet/product-identify.ts";
import { getRetailerAdapter } from "../leaflet/retailer-adapter.ts";
import {
  runThreePassProductFromImage,
  runThreePassVerification,
  type ThreePassHooks,
  type ThreePassProductResult,
} from "../leaflet/three-pass.ts";
import type { ProductBBox } from "../leaflet/product-bbox.ts";
import type { LeafletProduct } from "../leaflet/leaflet-product.ts";
import {
  AUTO_PARSER_PIPELINE,
  type PageImageReadyContext,
  type PageParserBackend,
  type ParserRunRecord,
  type StagingOfferRecord,
} from "./page-parser.ts";
import type { PdfPagesBackend } from "./pdf-pages.ts";

export const PARSER_RERUNS_TABLE = "leaflet_parser_reruns";

export type ParserRerunScope = "page" | "product";

export type ParserRerunAudit = {
  id: string;
  previous_run_id: string | null;
  new_run_id: string;
  created_at: string;
  model_version: string | null;
  parser_version: string;
  adapter_version: string;
  scope: ParserRerunScope;
};

export type RereadExistingOffer = StagingOfferRecord & {
  bbox?: ProductBBox | null;
};

export type PageRereadAuditBackend = {
  insertAudit(row: ParserRerunAudit): Promise<ParserRerunAudit>;
};

export function createMemoryRereadAuditBackend(): PageRereadAuditBackend & { audits: ParserRerunAudit[] } {
  const audits: ParserRerunAudit[] = [];
  return {
    audits,
    async insertAudit(row) {
      audits.push({ ...row });
      return { ...row };
    },
  };
}

export function createSupabaseRereadAuditBackend(supabase: any): PageRereadAuditBackend {
  return {
    async insertAudit(row) {
      const { data, error } = await supabase.from(PARSER_RERUNS_TABLE).insert(row).select("*").single();
      if (error || !data) throw new Error(error?.message || "leaflet_parser_reruns insert selhal.");
      return {
        id: String(data.id),
        previous_run_id: data.previous_run_id ?? null,
        new_run_id: String(data.new_run_id),
        created_at: String(data.created_at),
        model_version: data.model_version ?? null,
        parser_version: String(data.parser_version),
        adapter_version: String(data.adapter_version),
        scope: data.scope === "product" ? "product" : "page",
      };
    },
  };
}

export type RereadResult = {
  previous_run_id: string | null;
  run: ParserRunRecord;
  audit: ParserRerunAudit;
  offers: RereadExistingOffer[];
};

function assertOriginalImage(image: Uint8Array) {
  if (!image?.byteLength) throw new Error("Re-read musí začít z originálního obrázku stránky, ne z OCR textu.");
}

function neverApproved(status: StagingOfferRecord["review_status"]): StagingOfferRecord["review_status"] {
  return status === "needs_review" ? "needs_review" : "pending";
}

function toMergedOffer(
  page: PageImageReadyContext["page"],
  runId: string,
  current: RereadExistingOffer | null,
  ai: ThreePassProductResult,
): RereadExistingOffer {
  const stamped: LeafletProduct = {
    ...ai.product,
    store_id: page.store_id,
    page_no: page.page_no,
    source_type: "leaflet",
  };
  if (!current) {
    return {
      ...stamped,
      id: randomUUID(),
      batch_id: page.batch_id,
      page_id: page.page_id,
      review_status: neverApproved(ai.review_status),
      pipeline_version: `${AUTO_PARSER_PIPELINE}-3pass-reread`,
      ai_checks: ai.ai_checks,
      field_sources: emptyFieldSources(),
      ai_proposal: null,
      parser_run_id: runId,
      bbox: ai.bbox,
    };
  }
  const merged = mergeKeepingHumanFields(current, stamped, current.field_sources);
  return {
    ...current,
    ...merged.product,
    store_id: page.store_id,
    page_no: page.page_no,
    source_type: "leaflet",
    review_status: neverApproved(ai.review_status),
    pipeline_version: `${AUTO_PARSER_PIPELINE}-3pass-reread`,
    ai_checks: ai.ai_checks,
    field_sources: merged.field_sources,
    ai_proposal: Object.keys(merged.ai_proposal).length ? merged.ai_proposal : null,
    parser_run_id: runId,
    bbox: ai.bbox ?? current.bbox ?? current.ai_checks?.bbox ?? null,
  };
}

async function persistOffer(parser: PageParserBackend, offer: RereadExistingOffer, existed: boolean) {
  const { bbox: _bbox, ...row } = offer;
  if (existed) {
    try {
      await parser.updateStaging(offer.id, row);
      return;
    } catch {
      // session-only řádek ještě není ve staging
    }
  }
  await parser.insertStaging([row]);
}

async function startRun(
  deps: { pages: Pick<PdfPagesBackend, "updatePage">; parser: PageParserBackend },
  ctx: PageImageReadyContext,
): Promise<ParserRunRecord> {
  const adapter = getRetailerAdapter(ctx.page.store_id);
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
  await deps.pages.updatePage(ctx.page.page_id, { processing_status: "parsing", error_message: null });
  return run;
}

async function finishRun(
  parser: PageParserBackend,
  runId: string,
  patch: Partial<ParserRunRecord> & { status: ParserRunRecord["status"] },
) {
  return parser.updateParserRun(runId, { ...patch, finished_at: new Date().toISOString() });
}

async function writeAudit(
  audit: PageRereadAuditBackend,
  input: {
    previous_run_id: string | null;
    new_run_id: string;
    model_version: string | null;
    adapter_version: string;
    scope: ParserRerunScope;
  },
): Promise<ParserRerunAudit> {
  return audit.insertAudit({
    id: randomUUID(),
    previous_run_id: input.previous_run_id,
    new_run_id: input.new_run_id,
    created_at: new Date().toISOString(),
    model_version: input.model_version,
    parser_version: PARSER_VERSION,
    adapter_version: input.adapter_version,
    scope: input.scope,
  });
}

export async function rereadPageFromImage(
  deps: { pages: Pick<PdfPagesBackend, "updatePage">; parser: PageParserBackend; audit: PageRereadAuditBackend },
  ctx: PageImageReadyContext,
  existing: RereadExistingOffer[],
  previousRunId: string | null,
  hooks: ThreePassHooks = {},
): Promise<RereadResult> {
  assertOriginalImage(ctx.image);
  const adapter = getRetailerAdapter(ctx.page.store_id);
  const run = await startRun(deps, ctx);
  try {
    const request = {
      batch_id: ctx.page.batch_id,
      page_id: ctx.page.page_id,
      page_no: ctx.page.page_no,
      store_id: ctx.page.store_id,
      adapter,
      image: ctx.image,
      mime: "image/png" as const,
    };
    const threePass = await runThreePassVerification(request, ctx.image, hooks);
    const discovered = threePass.products.map((item) => ({ ...item.product, bbox: item.bbox }));
    const pairs = matchExistingToDiscovered(existing, discovered);
    const offers: RereadExistingOffer[] = [];
    for (const pair of pairs) {
      if (pair.discovered && pair.discoveredIndex != null) {
        const ai = threePass.products[pair.discoveredIndex]!;
        const merged = toMergedOffer(ctx.page, run.id, pair.existing, ai);
        await persistOffer(deps.parser, merged, Boolean(pair.existing?.id && existing.some((row) => row.id === pair.existing?.id)));
        offers.push(merged);
        continue;
      }
      if (pair.existing) offers.push(pair.existing);
    }
    const finished = await finishRun(deps.parser, run.id, {
      status: "parsed",
      model: threePass.pass1_model,
      error_message: null,
      validation_errors: null,
      raw_output: threePass.pass1_raw.slice(0, 20000),
      offer_count: offers.length,
    });
    await deps.pages.updatePage(ctx.page.page_id, { processing_status: "parsed", error_message: null });
    const auditRow = await writeAudit(deps.audit, {
      previous_run_id: previousRunId,
      new_run_id: finished.id,
      model_version: threePass.pass1_model,
      adapter_version: adapter.version || ADAPTER_VERSION,
      scope: "page",
    });
    return { previous_run_id: previousRunId, run: finished, audit: auditRow, offers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await finishRun(deps.parser, run.id, {
      status: "failed",
      error_message: message.slice(0, 2000),
      offer_count: 0,
    });
    throw Object.assign(error instanceof Error ? error : new Error(message), { run: failed });
  }
}

export async function rereadProductFromImage(
  deps: { pages: Pick<PdfPagesBackend, "updatePage">; parser: PageParserBackend; audit: PageRereadAuditBackend },
  ctx: PageImageReadyContext,
  existing: RereadExistingOffer,
  previousRunId: string | null,
  hooks: ThreePassHooks = {},
): Promise<RereadResult> {
  assertOriginalImage(ctx.image);
  const adapter = getRetailerAdapter(ctx.page.store_id);
  const run = await startRun(deps, ctx);
  try {
    const request = {
      batch_id: ctx.page.batch_id,
      page_id: ctx.page.page_id,
      page_no: ctx.page.page_no,
      store_id: ctx.page.store_id,
      adapter,
      image: ctx.image,
      mime: "image/png" as const,
    };
    const result = await runThreePassProductFromImage(
      request,
      ctx.image,
      {
        extracted_name: existing.extracted_name,
        brand: existing.brand,
        bbox: existing.bbox ?? existing.ai_checks?.bbox ?? null,
      },
      hooks,
    );
    const merged = toMergedOffer(ctx.page, run.id, existing, result.product);
    await persistOffer(deps.parser, merged, Boolean(existing.id));
    const finished = await finishRun(deps.parser, run.id, {
      status: "parsed",
      model: result.pass1_model,
      error_message: null,
      validation_errors: null,
      raw_output: result.pass1_raw.slice(0, 20000),
      offer_count: 1,
    });
    await deps.pages.updatePage(ctx.page.page_id, { processing_status: "parsed", error_message: null });
    const auditRow = await writeAudit(deps.audit, {
      previous_run_id: previousRunId,
      new_run_id: finished.id,
      model_version: result.pass1_model,
      adapter_version: adapter.version || ADAPTER_VERSION,
      scope: "product",
    });
    return { previous_run_id: previousRunId, run: finished, audit: auditRow, offers: [merged] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await finishRun(deps.parser, run.id, {
      status: "failed",
      error_message: message.slice(0, 2000),
      offer_count: 0,
    });
    throw Object.assign(error instanceof Error ? error : new Error(message), { run: failed });
  }
}

export function replaceOfferInList(
  offers: RereadExistingOffer[],
  next: RereadExistingOffer,
): RereadExistingOffer[] {
  const index = offers.findIndex((row) => row.id === next.id);
  if (index < 0) return [...offers, next];
  return offers.map((row, i) => (i === index ? next : row));
}

export type { FieldSources, AiProposal };
