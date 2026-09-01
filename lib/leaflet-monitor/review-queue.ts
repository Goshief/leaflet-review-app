import type { PdfIntakeRecord } from "./pdf-intake.ts";
import type { PdfPageRecord } from "./pdf-pages.ts";
import type { PageParserBackend, StagingOfferRecord } from "./page-parser.ts";

export const UNREVIEWED_STATUSES = ["pending", "needs_review"] as const;

export type QueuePointer = {
  batch_id: string;
  page_id: string;
  page_no: number;
  store_id: string;
  downloaded_at: string;
};

export type ReviewQueuePage = {
  batch_id: string;
  page_id: string;
  page_no: number;
  store_id: string;
  downloaded_at: string;
  image_storage_path: string;
  offers: StagingOfferRecord[];
  remaining_pages_in_batch: number;
  remaining_pages: number;
  remaining_leaflets: number;
};

export type ReviewLeafletSnapshot = {
  batch_id: string;
  store_id: string;
  downloaded_at: string;
  pages: Array<{
    page_id: string;
    page_no: number;
    image_storage_path: string;
    offers: StagingOfferRecord[];
  }>;
};

export function isUnreviewedStatus(status: string | null | undefined): boolean {
  return status === "pending" || status === "needs_review";
}

export function pageNeedsHumanReview(offers: Array<{ review_status?: string | null }>): boolean {
  return offers.some((row) => isUnreviewedStatus(row.review_status));
}

export function assertNoAutoApprove(offers: Array<{ review_status?: string | null }>): void {
  if (offers.some((row) => row.review_status === "approved")) {
    throw new Error("Parser/workflow nesmí automaticky schvalovat nabídky.");
  }
}

export function leafletsFromParts(
  intakes: PdfIntakeRecord[],
  pages: PdfPageRecord[],
  staging: StagingOfferRecord[],
): ReviewLeafletSnapshot[] {
  return intakes.map((intake) => ({
    batch_id: intake.batch_id,
    store_id: intake.store_id,
    downloaded_at: intake.downloaded_at || "",
    pages: pages
      .filter((page) => page.batch_id === intake.batch_id)
      .sort((a, b) => a.page_no - b.page_no)
      .map((page) => ({
        page_id: page.page_id,
        page_no: page.page_no,
        image_storage_path: page.image_storage_path,
        offers: staging.filter((row) => row.page_id === page.page_id),
      })),
  }));
}

export function unreviewedPointers(leaflets: ReviewLeafletSnapshot[]): QueuePointer[] {
  const out: QueuePointer[] = [];
  for (const leaflet of leaflets) {
    for (const page of leaflet.pages) {
      if (!pageNeedsHumanReview(page.offers)) continue;
      out.push({
        batch_id: leaflet.batch_id,
        page_id: page.page_id,
        page_no: page.page_no,
        store_id: leaflet.store_id,
        downloaded_at: leaflet.downloaded_at,
      });
    }
  }
  return out.sort((a, b) => {
    const time = Date.parse(b.downloaded_at || 0) - Date.parse(a.downloaded_at || 0);
    if (time !== 0) return time;
    if (a.batch_id !== b.batch_id) return a.batch_id < b.batch_id ? -1 : 1;
    return a.page_no - b.page_no;
  });
}

/** Newest leaflet, then first unreviewed page. */
export function nextReviewPage(leaflets: ReviewLeafletSnapshot[]): ReviewQueuePage | null {
  const pointers = unreviewedPointers(leaflets);
  const pointer = pointers[0];
  if (!pointer) return null;
  return hydrateQueuePage(leaflets, pointer, pointers);
}

export function hydrateQueuePage(
  leaflets: ReviewLeafletSnapshot[],
  pointer: QueuePointer,
  pointers = unreviewedPointers(leaflets),
): ReviewQueuePage | null {
  const leaflet = leaflets.find((row) => row.batch_id === pointer.batch_id);
  const page = leaflet?.pages.find((row) => row.page_id === pointer.page_id);
  if (!leaflet || !page) return null;
  return {
    batch_id: leaflet.batch_id,
    page_id: page.page_id,
    page_no: page.page_no,
    store_id: leaflet.store_id,
    downloaded_at: leaflet.downloaded_at,
    image_storage_path: page.image_storage_path,
    offers: page.offers,
    remaining_pages_in_batch: pointers.filter((row) => row.batch_id === leaflet.batch_id).length,
    remaining_pages: pointers.length,
    remaining_leaflets: new Set(pointers.map((row) => row.batch_id)).size,
  };
}

export function humanApproveOffers(
  offers: StagingOfferRecord[],
  ids?: string[] | null,
  at = new Date().toISOString(),
): StagingOfferRecord[] {
  const only = ids?.length ? new Set(ids) : null;
  return offers.map((row) => {
    if (only && !only.has(row.id)) return row;
    if (!isUnreviewedStatus(row.review_status)) return row;
    return { ...row, review_status: "approved", reviewed_at: at };
  });
}

const HUMAN_EDIT_KEYS: Array<keyof StagingOfferRecord> = [
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
  "field_sources",
  "ai_proposal",
];

/** Persistuje lidské úpravy polí. Nikdy nemění review_status. */
export async function persistHumanFieldEdits(
  parser: PageParserBackend,
  rows: Array<Partial<StagingOfferRecord> & { id?: string }>,
): Promise<void> {
  for (const row of rows) {
    if (!row.id) continue;
    const patch: Partial<StagingOfferRecord> = {};
    for (const key of HUMAN_EDIT_KEYS) {
      if (row[key] !== undefined) (patch as Record<string, unknown>)[key] = row[key];
    }
    if (Object.keys(patch).length) await parser.updateStaging(row.id, patch);
  }
}

export async function persistHumanApprovals(
  parser: PageParserBackend,
  offers: StagingOfferRecord[],
  ids?: string[] | null,
): Promise<StagingOfferRecord[]> {
  const next = humanApproveOffers(offers, ids);
  for (const row of next) {
    const prev = offers.find((item) => item.id === row.id);
    if (!prev || prev.review_status === row.review_status) continue;
    await parser.updateStaging(row.id, { review_status: "approved", reviewed_at: row.reviewed_at });
  }
  return next;
}

export function uniquePagePointers(
  pending: Array<{ batch_id: string; page_id: string; page_no: number; store_id: string }>,
  intakes: Array<{ batch_id: string; downloaded_at?: string | null; store_id?: string }>,
): QueuePointer[] {
  const downloaded = new Map(intakes.map((row) => [row.batch_id, row]));
  const byPage = new Map<string, QueuePointer>();
  for (const row of pending) {
    if (!row.page_id || byPage.has(row.page_id)) continue;
    const intake = downloaded.get(row.batch_id);
    byPage.set(row.page_id, {
      batch_id: row.batch_id,
      page_id: row.page_id,
      page_no: row.page_no,
      store_id: row.store_id || intake?.store_id || "",
      downloaded_at: intake?.downloaded_at || "",
    });
  }
  return [...byPage.values()].sort((a, b) => {
    const time = Date.parse(b.downloaded_at || 0) - Date.parse(a.downloaded_at || 0);
    if (time !== 0) return time;
    if (a.batch_id !== b.batch_id) return a.batch_id < b.batch_id ? -1 : 1;
    return a.page_no - b.page_no;
  });
}

export function queueStats(pointers: QueuePointer[], current?: QueuePointer | null) {
  return {
    remaining_pages: pointers.length,
    remaining_leaflets: new Set(pointers.map((row) => row.batch_id)).size,
    remaining_pages_in_batch: current ? pointers.filter((row) => row.batch_id === current.batch_id).length : 0,
  };
}
