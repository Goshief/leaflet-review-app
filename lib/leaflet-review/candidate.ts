export type LeafletRetailerId = "billa" | "lidl" | "kaufland" | "penny" | string;

export type LeafletBBox = {
  /** PDF/page coordinate system used by the extractor. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LeafletEvidence = {
  /** Exact source text. Never reconstructed or invented. */
  raw_text: string | null;
  /** Source rectangle on the reviewed page, if known. */
  bbox: LeafletBBox | null;
  /** Extraction mechanism that produced the value. */
  source: "pdf_text" | "ocr" | "parser" | "manual";
};

export type LeafletField<T> = {
  /** Null means the source did not prove a value. */
  value: T | null;
  /** 0..1 confidence of this field only, not of the whole product. */
  confidence: number | null;
  evidence: LeafletEvidence | null;
};

export type LeafletCandidateStatus =
  | "unreviewed"
  | "approved"
  | "rejected"
  | "needs_reread"
  | "quarantine";

export type LeafletReviewCandidate = {
  /** Stable candidate id inside one leaflet import. */
  candidate_id: string;
  /** Stable leaflet/import identity. */
  leaflet_id: string;
  import_id: string;
  retailer_id: LeafletRetailerId;
  source_url: string | null;
  storage_bucket: string;
  storage_path: string;

  page_no: number;
  page_count: number | null;
  /** Rectangle of the complete offer block. */
  source_bbox: LeafletBBox | null;
  /** Exact text belonging to the candidate block. */
  source_text: string | null;

  product_name: LeafletField<string>;
  brand: LeafletField<string>;
  variant: LeafletField<string>;

  pack_qty: LeafletField<number>;
  pack_unit: LeafletField<string>;
  pack_unit_qty: LeafletField<number>;
  pack_text: LeafletField<string>;

  /** Main promotional/sale price shown for the offer. */
  price_sale: LeafletField<number>;
  /** Ordinary/original price, only when explicitly shown. */
  price_standard: LeafletField<number>;
  /** Loyalty/card/club price, only when explicitly shown. */
  price_loyalty: LeafletField<number>;
  /** Explicit unit price such as Kč/kg or Kč/l. */
  price_per_unit: LeafletField<number>;
  price_per_unit_unit: LeafletField<string>;
  currency: "CZK";

  /** Whole-leaflet validity inherited only from verified leaflet metadata. */
  leaflet_valid_from: LeafletField<string>;
  leaflet_valid_to: LeafletField<string>;
  /** Item-specific override only if explicitly printed for this item. */
  item_valid_from: LeafletField<string>;
  item_valid_to: LeafletField<string>;

  loyalty_required: LeafletField<boolean>;
  promo_label: LeafletField<string>;
  promo_condition: LeafletField<string>;
  minimum_quantity: LeafletField<number>;

  status: LeafletCandidateStatus;
  /** Human-readable reason why this candidate requires review. */
  review_reason: string | null;
  /** Parser/extractor version for reproducible re-read. */
  extractor_version: string;
  created_at: string;
  updated_at: string;
};

/**
 * Hard rule for leaflet ingestion: missing source evidence is represented as null.
 * Callers must never synthesize product names, prices, validity or promotion conditions.
 */
export function emptyLeafletField<T>(): LeafletField<T> {
  return { value: null, confidence: null, evidence: null };
}
