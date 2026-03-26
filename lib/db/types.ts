/** Řádky odpovídající tabulkám v supabase/migrations */

export type ImportBatchStatus =
  | "uploaded"
  | "processing"
  | "review"
  | "imported"
  | "error";

export type OfferReviewStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "needs_review";

export type ImportBatchRow = {
  id: string;
  retailer: string;
  source_url: string | null;
  storage_path: string;
  original_filename: string;
  status: ImportBatchStatus;
  page_count: number | null;
  product_count: number | null;
  approved_count: number;
  rejected_count: number;
  pending_review_count: number;
  error_message: string | null;
  pipeline_version: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};
