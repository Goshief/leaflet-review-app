import { createHash, randomUUID } from "node:crypto";

export const PDF_INTAKE_BUCKET = "leaflet-intake";
export const PDF_INTAKE_TABLE = "leaflet_pdf_intake";
export const ORIGINAL_PDF_FILENAME = "original.pdf";

export type PdfIntakeStatus = "downloaded" | "download_failed" | "duplicate" | "pages_ready" | "pages_failed";

export type PdfIntakeRecord = {
  batch_id: string;
  store_id: string;
  source_url: string | null;
  pdf_source_url: string | null;
  pdf_storage_path: string | null;
  pdf_sha256: string | null;
  pdf_size_bytes: number | null;
  downloaded_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  status: PdfIntakeStatus;
  error_message?: string | null;
};

export type PdfIntakeResult = PdfIntakeRecord & {
  created_import: boolean;
  storage_overwritten: false;
};

export type DownloadedPdf = {
  ok: true;
  bytes: Uint8Array;
  final_url: string;
  content_type: string;
  http_status: number;
  sha256: string;
};

export type DownloadPdfFailure = {
  ok: false;
  error: string;
  http_status: number | null;
  final_url: string | null;
};

const USER_AGENT = "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";

export function originalPdfStoragePath(storeId: string, year: number | string, batchId: string): string {
  return `leaflets/${storeId}/${year}/${batchId}/${ORIGINAL_PDF_FILENAME}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isOriginalPdf(bytes: Uint8Array, contentType?: string | null): boolean {
  if (bytes.byteLength < 5) return false;
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (signature === "%PDF-") return true;
  return (contentType || "").toLowerCase().includes("application/pdf");
}

export function intakeYear(downloadedAt: string, validFrom?: string | null): number {
  const fromValidity = validFrom ? Number(String(validFrom).slice(0, 4)) : NaN;
  if (Number.isFinite(fromValidity) && fromValidity >= 2000) return fromValidity;
  const fromDownload = new Date(downloadedAt).getUTCFullYear();
  return Number.isFinite(fromDownload) ? fromDownload : new Date().getUTCFullYear();
}

export type PdfIntakeBackend = {
  findBySha256(sha256: string): Promise<PdfIntakeRecord | null>;
  findFailedByPdfUrl(storeId: string, pdfSourceUrl: string): Promise<PdfIntakeRecord | null>;
  insert(row: PdfIntakeRecord): Promise<PdfIntakeRecord>;
  update(batchId: string, patch: Partial<PdfIntakeRecord>): Promise<PdfIntakeRecord>;
  putOriginal(path: string, bytes: Uint8Array): Promise<{ written: boolean; existed: boolean }>;
  getOriginal(path: string): Promise<Uint8Array | null>;
};

export function createMemoryPdfIntakeBackend(): PdfIntakeBackend & {
  rows: PdfIntakeRecord[];
  files: Map<string, Uint8Array>;
} {
  const rows: PdfIntakeRecord[] = [];
  const files = new Map<string, Uint8Array>();
  return {
    rows,
    files,
    async findBySha256(sha256) {
      return rows.find((row) => row.pdf_sha256 === sha256 && row.status !== "download_failed") ?? null;
    },
    async findFailedByPdfUrl(storeId, pdfSourceUrl) {
      return rows.find((row) => row.store_id === storeId && row.pdf_source_url === pdfSourceUrl && row.status === "download_failed") ?? null;
    },
    async insert(row) {
      rows.push({ ...row });
      return { ...row };
    },
    async update(batchId, patch) {
      const current = rows.find((row) => row.batch_id === batchId);
      if (!current) throw new Error(`leaflet_pdf_intake ${batchId} nebyl nalezen.`);
      Object.assign(current, patch);
      return { ...current };
    },
    async putOriginal(path, bytes) {
      if (files.has(path)) return { written: false, existed: true };
      files.set(path, bytes.slice());
      return { written: true, existed: false };
    },
    async getOriginal(path) {
      const stored = files.get(path);
      return stored ? stored.slice() : null;
    },
  };
}

export function createSupabasePdfIntakeBackend(supabase: any): PdfIntakeBackend {
  return {
    async findBySha256(sha256) {
      const { data, error } = await supabase
        .from(PDF_INTAKE_TABLE)
        .select("batch_id,store_id,source_url,pdf_source_url,pdf_storage_path,pdf_sha256,pdf_size_bytes,downloaded_at,valid_from,valid_to,status,error_message")
        .eq("pdf_sha256", sha256)
        .neq("status", "download_failed")
        .maybeSingle();
      if (error) throw new Error(`leaflet_pdf_intake sha lookup: ${error.message}`);
      return data ? asRecord(data) : null;
    },
    async findFailedByPdfUrl(storeId, pdfSourceUrl) {
      const { data, error } = await supabase
        .from(PDF_INTAKE_TABLE)
        .select("batch_id,store_id,source_url,pdf_source_url,pdf_storage_path,pdf_sha256,pdf_size_bytes,downloaded_at,valid_from,valid_to,status,error_message")
        .eq("store_id", storeId)
        .eq("pdf_source_url", pdfSourceUrl)
        .eq("status", "download_failed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`leaflet_pdf_intake retry lookup: ${error.message}`);
      return data ? asRecord(data) : null;
    },
    async insert(row) {
      const { data, error } = await supabase.from(PDF_INTAKE_TABLE).insert(toRow(row)).select("*").single();
      if (error || !data) throw new Error(error?.message || "leaflet_pdf_intake insert selhal.");
      return asRecord(data);
    },
    async update(batchId, patch) {
      const { data, error } = await supabase.from(PDF_INTAKE_TABLE).update(toRow(patch)).eq("batch_id", batchId).select("*").single();
      if (error || !data) throw new Error(error?.message || "leaflet_pdf_intake update selhal.");
      return asRecord(data);
    },
    async putOriginal(path, bytes) {
      const { error } = await supabase.storage.from(PDF_INTAKE_BUCKET).upload(path, bytes, {
        contentType: "application/pdf",
        upsert: false,
        cacheControl: "31536000",
      });
      if (!error) return { written: true, existed: false };
      if (/already exists|duplicate|resource exists/i.test(error.message || "")) {
        return { written: false, existed: true };
      }
      throw new Error(`Original PDF upload: ${error.message}`);
    },
    async getOriginal(path) {
      const { data, error } = await supabase.storage.from(PDF_INTAKE_BUCKET).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

function asRecord(row: any): PdfIntakeRecord {
  return {
    batch_id: String(row.batch_id),
    store_id: String(row.store_id),
    source_url: row.source_url ?? null,
    pdf_source_url: row.pdf_source_url ?? null,
    pdf_storage_path: row.pdf_storage_path ?? null,
    pdf_sha256: row.pdf_sha256 ?? null,
    pdf_size_bytes: row.pdf_size_bytes == null ? null : Number(row.pdf_size_bytes),
    downloaded_at: row.downloaded_at ?? null,
    valid_from: row.valid_from ?? null,
    valid_to: row.valid_to ?? null,
    status: row.status,
    error_message: row.error_message ?? null,
  };
}

function toRow(row: Partial<PdfIntakeRecord>) {
  const out: Record<string, unknown> = {};
  if (row.batch_id !== undefined) out.batch_id = row.batch_id;
  if (row.store_id !== undefined) out.store_id = row.store_id;
  if (row.source_url !== undefined) out.source_url = row.source_url;
  if (row.pdf_source_url !== undefined) out.pdf_source_url = row.pdf_source_url;
  if (row.pdf_storage_path !== undefined) out.pdf_storage_path = row.pdf_storage_path;
  if (row.pdf_sha256 !== undefined) out.pdf_sha256 = row.pdf_sha256;
  if (row.pdf_size_bytes !== undefined) out.pdf_size_bytes = row.pdf_size_bytes;
  if (row.downloaded_at !== undefined) out.downloaded_at = row.downloaded_at;
  if (row.valid_from !== undefined) out.valid_from = row.valid_from;
  if (row.valid_to !== undefined) out.valid_to = row.valid_to;
  if (row.status !== undefined) out.status = row.status;
  if (row.error_message !== undefined) out.error_message = row.error_message;
  return out;
}

export async function downloadOriginalPdf(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadedPdf | DownloadPdfFailure> {
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
      },
    });
    const finalUrl = response.url || url;
    if (!response.ok) {
      return { ok: false, error: `PDF HTTP ${response.status}`, http_status: response.status, final_url: finalUrl };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "";
    if (!isOriginalPdf(bytes, contentType)) {
      return { ok: false, error: `Neplatné PDF (Content-Type ${contentType || "chybí"}, signature není %PDF-)`, http_status: response.status, final_url: finalUrl };
    }
    return {
      ok: true,
      bytes,
      final_url: finalUrl,
      content_type: contentType,
      http_status: response.status,
      sha256: sha256Hex(bytes),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      http_status: null,
      final_url: url,
    };
  }
}

export async function recordDownloadFailure(
  backend: PdfIntakeBackend,
  input: {
    store_id: string;
    source_url: string | null;
    pdf_source_url: string | null;
    error: string;
    valid_from?: string | null;
    valid_to?: string | null;
  },
): Promise<PdfIntakeResult> {
  const existing = input.pdf_source_url ? await backend.findFailedByPdfUrl(input.store_id, input.pdf_source_url) : null;
  const row: PdfIntakeRecord = {
    batch_id: existing?.batch_id ?? randomUUID(),
    store_id: input.store_id,
    source_url: input.source_url,
    pdf_source_url: input.pdf_source_url,
    pdf_storage_path: null,
    pdf_sha256: null,
    pdf_size_bytes: null,
    downloaded_at: null,
    valid_from: input.valid_from ?? null,
    valid_to: input.valid_to ?? null,
    status: "download_failed",
    error_message: input.error.slice(0, 2000),
  };
  const saved = existing ? await backend.update(existing.batch_id, row) : await backend.insert(row);
  return { ...saved, created_import: false, storage_overwritten: false };
}

export async function ingestOriginalPdf(
  backend: PdfIntakeBackend,
  input: {
    store_id: string;
    source_url: string | null;
    pdf_source_url: string | null;
    bytes: Uint8Array;
    content_type?: string | null;
    valid_from?: string | null;
    valid_to?: string | null;
    downloaded_at?: string;
  },
): Promise<PdfIntakeResult> {
  if (!isOriginalPdf(input.bytes, input.content_type)) {
    return recordDownloadFailure(backend, {
      store_id: input.store_id,
      source_url: input.source_url,
      pdf_source_url: input.pdf_source_url,
      error: "Stažený soubor není platné PDF.",
      valid_from: input.valid_from,
      valid_to: input.valid_to,
    });
  }

  const sha256 = sha256Hex(input.bytes);
  const existing = await backend.findBySha256(sha256);
  if (existing) {
    return {
      ...existing,
      status: "duplicate",
      source_url: existing.source_url ?? input.source_url,
      pdf_source_url: existing.pdf_source_url ?? input.pdf_source_url,
      created_import: false,
      storage_overwritten: false,
    };
  }

  const downloadedAt = input.downloaded_at ?? new Date().toISOString();
  const failed = input.pdf_source_url ? await backend.findFailedByPdfUrl(input.store_id, input.pdf_source_url) : null;
  const batchId = failed?.batch_id ?? randomUUID();
  const path = originalPdfStoragePath(input.store_id, intakeYear(downloadedAt, input.valid_from), batchId);
  const stored = await backend.putOriginal(path, input.bytes);
  if (stored.existed) {
    const already = await backend.getOriginal(path);
    if (already && sha256Hex(already) !== sha256) {
      throw new Error(`Originální PDF na ${path} už existuje a nesmí se přepsat.`);
    }
  }

  const row: PdfIntakeRecord = {
    batch_id: batchId,
    store_id: input.store_id,
    source_url: input.source_url,
    pdf_source_url: input.pdf_source_url,
    pdf_storage_path: path,
    pdf_sha256: sha256,
    pdf_size_bytes: input.bytes.byteLength,
    downloaded_at: downloadedAt,
    valid_from: input.valid_from ?? null,
    valid_to: input.valid_to ?? null,
    status: "downloaded",
    error_message: null,
  };
  const saved = failed ? await backend.update(batchId, row) : await backend.insert(row);
  return { ...saved, created_import: true, storage_overwritten: false };
}

export async function downloadAndArchivePdf(
  backend: PdfIntakeBackend,
  input: {
    store_id: string;
    source_url: string | null;
    pdf_source_url: string;
    valid_from?: string | null;
    valid_to?: string | null;
    fetchImpl?: typeof fetch;
  },
): Promise<PdfIntakeResult> {
  const downloaded = await downloadOriginalPdf(input.pdf_source_url, input.fetchImpl);
  if (!downloaded.ok) {
    return recordDownloadFailure(backend, {
      store_id: input.store_id,
      source_url: input.source_url,
      pdf_source_url: input.pdf_source_url,
      error: downloaded.error,
      valid_from: input.valid_from,
      valid_to: input.valid_to,
    });
  }
  return ingestOriginalPdf(backend, {
    store_id: input.store_id,
    source_url: input.source_url,
    pdf_source_url: downloaded.final_url || input.pdf_source_url,
    bytes: downloaded.bytes,
    content_type: downloaded.content_type,
    valid_from: input.valid_from,
    valid_to: input.valid_to,
  });
}
