import { randomUUID } from "node:crypto";
import {
  PDF_INTAKE_BUCKET,
  PDF_INTAKE_TABLE,
  type PdfIntakeRecord,
  type PdfIntakeResult,
} from "./pdf-intake.ts";
import type { RenderedPdfPage } from "../pdf/render-pages-node.ts";

export const PDF_PAGES_TABLE = "leaflet_pdf_pages";

export const PAGE_PROCESSING_STATUSES = [
  "rendered",
  "queued",
  "parsing",
  "parsed",
  "failed",
  "needs_review",
] as const;

export type PageProcessingStatus = (typeof PAGE_PROCESSING_STATUSES)[number];

export type PdfPageRecord = {
  page_id: string;
  batch_id: string;
  store_id: string;
  page_no: number;
  image_storage_path: string;
  width: number;
  height: number;
  rendered_at: string;
  processing_status: PageProcessingStatus;
  error_message?: string | null;
};

export type PageImageReadyHandler = (ctx: {
  archive: PdfIntakeResult;
  page: PdfPageRecord;
  image: Uint8Array;
}) => Promise<unknown>;

export type EnsurePagesOptions = {
  onPageImage?: PageImageReadyHandler;
};

export type PdfPagesBackend = {
  listPages(batchId: string): Promise<PdfPageRecord[]>;
  insertPage(row: PdfPageRecord): Promise<PdfPageRecord>;
  updatePage(pageId: string, patch: Partial<Pick<PdfPageRecord, "processing_status" | "error_message">>): Promise<PdfPageRecord>;
  putPageImage(path: string, bytes: Uint8Array): Promise<{ written: boolean; existed: boolean }>;
  getPageImage(path: string): Promise<Uint8Array | null>;
  updateIntake(batchId: string, patch: Partial<PdfIntakeRecord>): Promise<PdfIntakeRecord>;
};

export function pageImageStoragePath(
  storeId: string,
  year: number | string,
  batchId: string,
  pageNo: number,
): string {
  return `leaflets/${storeId}/${year}/${batchId}/pages/${String(pageNo).padStart(3, "0")}.png`;
}

export function yearFromOriginalPath(path: string | null | undefined, fallback = new Date().getUTCFullYear()): number {
  const match = String(path || "").match(/^leaflets\/[^/]+\/(\d{4})\//);
  const year = match ? Number(match[1]) : fallback;
  return Number.isFinite(year) ? year : fallback;
}

export function createMemoryPdfPagesBackend(
  intakeRows: PdfIntakeRecord[],
  files: Map<string, Uint8Array>,
): PdfPagesBackend & { pages: PdfPageRecord[] } {
  const pages: PdfPageRecord[] = [];
  return {
    pages,
    async listPages(batchId) {
      return pages.filter((row) => row.batch_id === batchId).sort((a, b) => a.page_no - b.page_no);
    },
    async insertPage(row) {
      if (pages.some((existing) => existing.batch_id === row.batch_id && existing.page_no === row.page_no)) {
        throw new Error(`Stránka ${row.page_no} už v batch ${row.batch_id} existuje.`);
      }
      pages.push({ ...row });
      return { ...row };
    },
    async updatePage(pageId, patch) {
      const current = pages.find((row) => row.page_id === pageId);
      if (!current) throw new Error(`leaflet_pdf_pages ${pageId} nebyl nalezen.`);
      Object.assign(current, patch);
      return { ...current };
    },
    async putPageImage(path, bytes) {
      if (files.has(path)) return { written: false, existed: true };
      files.set(path, bytes.slice());
      return { written: true, existed: false };
    },
    async getPageImage(path) {
      const stored = files.get(path);
      return stored ? stored.slice() : null;
    },
    async updateIntake(batchId, patch) {
      const current = intakeRows.find((row) => row.batch_id === batchId);
      if (!current) throw new Error(`leaflet_pdf_intake ${batchId} nebyl nalezen.`);
      Object.assign(current, patch);
      return { ...current };
    },
  };
}

export function createSupabasePdfPagesBackend(supabase: any): PdfPagesBackend {
  return {
    async listPages(batchId) {
      const { data, error } = await supabase
        .from(PDF_PAGES_TABLE)
        .select("page_id,batch_id,store_id,page_no,image_storage_path,width,height,rendered_at,processing_status,error_message")
        .eq("batch_id", batchId)
        .order("page_no", { ascending: true });
      if (error) throw new Error(`leaflet_pdf_pages list: ${error.message}`);
      return (data ?? []).map(asPage);
    },
    async insertPage(row) {
      const { data, error } = await supabase.from(PDF_PAGES_TABLE).insert(toPageRow(row)).select("*").single();
      if (error || !data) throw new Error(error?.message || "leaflet_pdf_pages insert selhal.");
      return asPage(data);
    },
    async updatePage(pageId, patch) {
      const { data, error } = await supabase
        .from(PDF_PAGES_TABLE)
        .update({
          processing_status: patch.processing_status,
          error_message: patch.error_message ?? null,
        })
        .eq("page_id", pageId)
        .select("*")
        .single();
      if (error || !data) throw new Error(error?.message || "leaflet_pdf_pages update selhal.");
      return asPage(data);
    },
    async putPageImage(path, bytes) {
      const { error } = await supabase.storage.from(PDF_INTAKE_BUCKET).upload(path, bytes, {
        contentType: "image/png",
        upsert: false,
        cacheControl: "31536000",
      });
      if (!error) return { written: true, existed: false };
      if (/already exists|duplicate|resource exists/i.test(error.message || "")) {
        return { written: false, existed: true };
      }
      throw new Error(`Page PNG upload: ${error.message}`);
    },
    async getPageImage(path) {
      const { data, error } = await supabase.storage.from(PDF_INTAKE_BUCKET).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async updateIntake(batchId, patch) {
      const { data, error } = await supabase.from(PDF_INTAKE_TABLE).update(toIntakePatch(patch)).eq("batch_id", batchId).select("*").single();
      if (error || !data) throw new Error(error?.message || "leaflet_pdf_intake page status update selhal.");
      return {
        batch_id: String(data.batch_id),
        store_id: String(data.store_id),
        source_url: data.source_url ?? null,
        pdf_source_url: data.pdf_source_url ?? null,
        pdf_storage_path: data.pdf_storage_path ?? null,
        pdf_sha256: data.pdf_sha256 ?? null,
        pdf_size_bytes: data.pdf_size_bytes == null ? null : Number(data.pdf_size_bytes),
        downloaded_at: data.downloaded_at ?? null,
        valid_from: data.valid_from ?? null,
        valid_to: data.valid_to ?? null,
        status: data.status,
        error_message: data.error_message ?? null,
      };
    },
  };
}

function asPageStatus(value: unknown): PageProcessingStatus {
  return PAGE_PROCESSING_STATUSES.includes(value as PageProcessingStatus)
    ? (value as PageProcessingStatus)
    : "rendered";
}

function needsFirstParse(status: PageProcessingStatus): boolean {
  return status === "rendered" || status === "queued" || status === "parsing";
}

async function enqueueExistingPages(
  backend: PdfPagesBackend,
  archive: PdfIntakeResult,
  onPageImage: PageImageReadyHandler | undefined,
): Promise<PdfPageRecord[]> {
  const pages = await backend.listPages(archive.batch_id);
  if (!onPageImage) return pages;
  for (const page of pages) {
    if (!needsFirstParse(page.processing_status)) continue;
    const image = await backend.getPageImage(page.image_storage_path);
    if (!image?.byteLength) continue;
    try {
      await onPageImage({ archive, page, image });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await backend.updatePage(page.page_id, { processing_status: "failed", error_message: message.slice(0, 2000) });
      } catch {}
    }
  }
  return backend.listPages(archive.batch_id);
}

function asPage(row: any): PdfPageRecord {
  return {
    page_id: String(row.page_id),
    batch_id: String(row.batch_id),
    store_id: String(row.store_id),
    page_no: Number(row.page_no),
    image_storage_path: String(row.image_storage_path),
    width: Number(row.width ?? 0),
    height: Number(row.height ?? 0),
    rendered_at: String(row.rendered_at ?? ""),
    processing_status: asPageStatus(row.processing_status),
    error_message: row.error_message ?? null,
  };
}

function toPageRow(row: PdfPageRecord) {
  return {
    page_id: row.page_id,
    batch_id: row.batch_id,
    store_id: row.store_id,
    page_no: row.page_no,
    image_storage_path: row.image_storage_path,
    width: row.width,
    height: row.height,
    rendered_at: row.rendered_at,
    processing_status: row.processing_status,
    error_message: row.error_message ?? null,
  };
}

function toIntakePatch(patch: Partial<PdfIntakeRecord>) {
  const out: Record<string, unknown> = {};
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.error_message !== undefined) out.error_message = patch.error_message;
  return out;
}

async function defaultRender(bytes: Uint8Array): Promise<RenderedPdfPage[]> {
  const { renderPdfPagesToPng } = await import("../pdf/render-pages-node.ts");
  return renderPdfPagesToPng(bytes);
}

export async function ensurePagesAfterDownload(
  backend: PdfPagesBackend,
  archive: PdfIntakeResult,
  bytes: Uint8Array,
  render: ((pdf: Uint8Array) => Promise<RenderedPdfPage[]>) | undefined = defaultRender,
  options?: EnsurePagesOptions,
): Promise<{ pages: PdfPageRecord[]; batch_status: "pages_ready" | "pages_failed" | "duplicate" }> {
  const renderPages = render ?? defaultRender;
  const onPageImage = options?.onPageImage;

  if (archive.status === "download_failed" || !archive.batch_id) {
    return { pages: [], batch_status: "pages_failed" };
  }

  const existing = await backend.listPages(archive.batch_id);
  if (archive.status === "pages_ready" && existing.length > 0) {
    const pages = await enqueueExistingPages(backend, archive, onPageImage);
    return { pages, batch_status: "pages_ready" };
  }
  if (archive.status === "duplicate" && existing.length > 0) {
    const pages = await enqueueExistingPages(backend, archive, onPageImage);
    return { pages, batch_status: "pages_ready" };
  }

  const year = yearFromOriginalPath(archive.pdf_storage_path);
  const renderedAt = new Date().toISOString();
  const have = new Set(existing.map((row) => row.page_no));
  const pages = existing.slice();
  let failed = 0;

  let rendered: RenderedPdfPage[];
  try {
    rendered = await renderPages(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await backend.updateIntake(archive.batch_id, { status: "pages_failed", error_message: message.slice(0, 2000) });
    return { pages, batch_status: "pages_failed" };
  }

  for (const page of rendered) {
    if (have.has(page.page_no)) continue;
    const imagePath = pageImageStoragePath(archive.store_id, year, archive.batch_id, page.page_no);
    try {
      await backend.putPageImage(imagePath, page.png);
      const row = await backend.insertPage({
        page_id: randomUUID(),
        batch_id: archive.batch_id,
        store_id: archive.store_id,
        page_no: page.page_no,
        image_storage_path: imagePath,
        width: page.width,
        height: page.height,
        rendered_at: renderedAt,
        processing_status: "rendered",
        error_message: null,
      });
      pages.push(row);
      if (onPageImage) {
        try {
          await onPageImage({ archive, page: row, image: page.png });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          try {
            await backend.updatePage(row.page_id, { processing_status: "failed", error_message: message.slice(0, 2000) });
          } catch {}
        }
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      try {
        await backend.insertPage({
          page_id: randomUUID(),
          batch_id: archive.batch_id,
          store_id: archive.store_id,
          page_no: page.page_no,
          image_storage_path: imagePath,
          width: page.width,
          height: page.height,
          rendered_at: renderedAt,
          processing_status: "failed",
          error_message: message.slice(0, 2000),
        });
      } catch {}
    }
  }

  const batchStatus = failed === 0 && pages.length > 0 ? "pages_ready" : "pages_failed";
  await backend.updateIntake(archive.batch_id, {
    status: batchStatus,
    error_message: failed === 0 ? null : `Nepodařilo se vyrenderovat ${failed} stran.`,
  });
  if (onPageImage && batchStatus === "pages_ready") {
    const parsed = await enqueueExistingPages(backend, { ...archive, status: "pages_ready" }, onPageImage);
    return { pages: parsed.sort((a, b) => a.page_no - b.page_no), batch_status: batchStatus };
  }
  return { pages: pages.sort((a, b) => a.page_no - b.page_no), batch_status: batchStatus };
}
