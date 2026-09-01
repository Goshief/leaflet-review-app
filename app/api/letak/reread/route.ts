import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";
import { requireOperatorApi } from "@/lib/auth/guards";
import { normalizeFieldSources } from "@/lib/leaflet/field-source";
import { normalizeProductBBox, type ProductBBox } from "@/lib/leaflet/product-bbox";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  createMemoryPageParserBackend,
  createSupabasePageParserBackend,
  type PageParserBackend,
  type StagingOfferRecord,
} from "@/lib/leaflet-monitor/page-parser";
import {
  createMemoryRereadAuditBackend,
  createSupabaseRereadAuditBackend,
  rereadPageFromImage,
  rereadProductFromImage,
  type PageRereadAuditBackend,
  type RereadExistingOffer,
} from "@/lib/leaflet-monitor/page-reread";
import { createSupabasePdfPagesBackend, PDF_PAGES_TABLE, type PdfPageRecord } from "@/lib/leaflet-monitor/pdf-pages";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED_IMAGE = /^image\/(jpeg|png|webp|gif)$/i;

function asOffer(row: Record<string, unknown>, page: PdfPageRecord): RereadExistingOffer {
  const sources = normalizeFieldSources(row.field_sources);
  return {
    ...(row as unknown as StagingOfferRecord),
    id: String(row.id || randomUUID()),
    batch_id: String(row.batch_id || page.batch_id),
    page_id: String(row.page_id || page.page_id),
    store_id: String(row.store_id || page.store_id),
    source_type: "leaflet",
    page_no: Number(row.page_no ?? page.page_no),
    review_status:
      row.review_status === "needs_review" || row.review_status === "approved" || row.review_status === "rejected"
        ? row.review_status
        : "pending",
    pipeline_version: String(row.pipeline_version || "letak-session"),
    field_sources: sources,
    ai_proposal: (row.ai_proposal as StagingOfferRecord["ai_proposal"]) ?? null,
    bbox: normalizeProductBBox(row.bbox) ?? normalizeProductBBox((row.ai_checks as { bbox?: unknown } | null)?.bbox),
    currency: "CZK",
  };
}

export async function POST(req: NextRequest) {
  const requestId = makeRequestId();
  const gate = await requireOperatorApi({ requestId });
  if (!gate.ok) return gate.response;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) {
      return NextResponse.json(
        safeErrorJson({ status: 400, code: "BAD_REQUEST", message: "Chybí originální obrázek stránky.", requestId }),
        { status: 400 },
      );
    }
    if (file.type && !ALLOWED_IMAGE.test(file.type)) {
      return NextResponse.json(
        safeErrorJson({ status: 400, code: "BAD_REQUEST", message: "Re-read přijímá jen obrázek stránky, ne OCR text.", requestId }),
        { status: 400 },
      );
    }

    const scope = String(form.get("scope") || "page") === "product" ? "product" : "page";
    const pageNo = Number(form.get("page_no") || 1);
    const storeId = String(form.get("store_id") || "lidl");
    const previousRunId = String(form.get("previous_run_id") || "") || null;
    const productIndex = Number(form.get("product_index") ?? -1);
    const image = new Uint8Array(await file.arrayBuffer());
    if (!image.byteLength) {
      return NextResponse.json(
        safeErrorJson({ status: 400, code: "BAD_REQUEST", message: "Re-read musí začít z originálního obrázku stránky.", requestId }),
        { status: 400 },
      );
    }

    const page: PdfPageRecord = {
      page_id: String(form.get("page_id") || randomUUID()),
      batch_id: String(form.get("batch_id") || randomUUID()),
      store_id: storeId,
      page_no: Number.isFinite(pageNo) && pageNo >= 1 ? pageNo : 1,
      image_storage_path: "session/page.png",
      width: 1,
      height: 1,
      rendered_at: new Date().toISOString(),
      processing_status: "parsed",
    };
    let offersJson: unknown[] = [];
    try {
      offersJson = JSON.parse(String(form.get("offers") || "[]"));
    } catch {
      offersJson = [];
    }
    if (!Array.isArray(offersJson)) offersJson = [];
    const existingFromForm = offersJson.map((row) => asOffer(row as Record<string, unknown>, page));

    const supabase = getSupabaseAdmin();
    const memoryParser = createMemoryPageParserBackend();
    let parser: PageParserBackend = memoryParser;
    let audit: PageRereadAuditBackend = createMemoryRereadAuditBackend();
    let pages: { updatePage: (id: string, patch: Partial<PdfPageRecord>) => Promise<PdfPageRecord> } = {
      async updatePage(_id: string, patch: Partial<PdfPageRecord>) {
        return { ...page, ...patch };
      },
    };
    let existing = existingFromForm;
    let pageImage = image;
    let persisted = false;

    if (supabase && form.get("page_id")) {
      const { data: stored } = await supabase
        .from(PDF_PAGES_TABLE)
        .select("page_id,batch_id,store_id,page_no,image_storage_path,width,height,rendered_at,processing_status")
        .eq("page_id", page.page_id)
        .maybeSingle();
      if (stored) {
        const pagesBackend = createSupabasePdfPagesBackend(supabase);
        parser = createSupabasePageParserBackend(supabase);
        audit = createSupabaseRereadAuditBackend(supabase);
        pages = pagesBackend;
        persisted = true;
        Object.assign(page, {
          page_id: String(stored.page_id),
          batch_id: String(stored.batch_id),
          store_id: String(stored.store_id),
          page_no: Number(stored.page_no),
          image_storage_path: String(stored.image_storage_path),
        });
        const disk = await pagesBackend.getPageImage(String(stored.image_storage_path));
        if (disk?.byteLength) pageImage = Uint8Array.from(disk);
        const staged = await parser.listStagingByPage(page.page_id);
        if (staged.length) existing = staged.map((row) => asOffer(row as unknown as Record<string, unknown>, page));
      }
    }

    if (!persisted && existing.length) {
      const insertable = existing
        .filter((row) => row.review_status === "pending" || row.review_status === "needs_review")
        .map(({ bbox: _b, ...row }) => row);
      if (insertable.length) await memoryParser.insertStaging(insertable);
    }

    const ctx = {
      archive: {
        batch_id: page.batch_id,
        store_id: page.store_id,
        source_url: null,
        pdf_storage_path: "",
      } as never,
      page,
      image: pageImage,
    };

    const bboxRaw = form.get("bbox");
    let bbox: ProductBBox | null = null;
    if (typeof bboxRaw === "string" && bboxRaw.trim()) {
      try {
        bbox = normalizeProductBBox(JSON.parse(bboxRaw));
      } catch {
        bbox = null;
      }
    }

    const result =
      scope === "product"
        ? await rereadProductFromImage(
            { pages, parser, audit },
            ctx,
            {
              ...(existing[productIndex] ?? existing[0] ?? asOffer({ extracted_name: String(form.get("extracted_name") || "") }, page)),
              bbox: bbox ?? existing[productIndex]?.bbox ?? null,
            },
            previousRunId,
          )
        : await rereadPageFromImage({ pages, parser, audit }, ctx, existing, previousRunId);

    return NextResponse.json({
      ok: true,
      scope,
      previous_run_id: result.previous_run_id,
      new_run_id: result.run.id,
      parser_run: result.run,
      audit: result.audit,
      offers: result.offers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      safeErrorJson({ status: 500, code: "INTERNAL_ERROR", message, requestId, cause: error }),
      { status: 500 },
    );
  }
}