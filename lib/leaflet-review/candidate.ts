export type LeafletRetailerId = "billa" | "lidl" | "kaufland" | "penny" | string;

export type LeafletBBox = { x: number; y: number; width: number; height: number };
export type LeafletEvidence = { raw_text: string | null; bbox: LeafletBBox | null; source: "pdf_text" | "ocr" | "parser" | "manual" };
export type LeafletField<T> = { value: T | null; confidence: number | null; evidence: LeafletEvidence | null };
export type LeafletCandidateStatus = "unreviewed" | "approved" | "rejected" | "needs_reread" | "quarantine";

export type LeafletReviewCandidate = {
  candidate_id: string;
  leaflet_id: string;
  import_id: string;
  retailer_id: LeafletRetailerId;
  source_url: string | null;
  storage_bucket: string;
  storage_path: string;
  page_no: number;
  page_count: number | null;
  source_bbox: LeafletBBox | null;
  source_text: string | null;
  product_name: LeafletField<string>;
  brand: LeafletField<string>;
  variant: LeafletField<string>;
  pack_qty: LeafletField<number>;
  pack_unit: LeafletField<string>;
  pack_unit_qty: LeafletField<number>;
  pack_text: LeafletField<string>;
  price_sale: LeafletField<number>;
  price_standard: LeafletField<number>;
  price_loyalty: LeafletField<number>;
  price_without_loyalty: LeafletField<number>;
  price_per_unit: LeafletField<number>;
  price_per_unit_unit: LeafletField<string>;
  currency: "CZK";
  leaflet_valid_from: LeafletField<string>;
  leaflet_valid_to: LeafletField<string>;
  item_valid_from: LeafletField<string>;
  item_valid_to: LeafletField<string>;
  loyalty_required: LeafletField<boolean>;
  promo_label: LeafletField<string>;
  promo_condition: LeafletField<string>;
  minimum_quantity: LeafletField<number>;
  status: LeafletCandidateStatus;
  review_reason: string | null;
  extractor_version: string;
  created_at: string;
  updated_at: string;
};

/** Missing source evidence is always null. Never synthesize product names, prices, validity or promotion conditions. */
export function emptyLeafletField<T>(): LeafletField<T> { return { value: null, confidence: null, evidence: null }; }
