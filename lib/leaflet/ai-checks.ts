import { LEAFLET_PRODUCT_KEYS, type LeafletProduct, type LeafletProductKey } from "./leaflet-product.ts";
import type { ProductBBox } from "./product-bbox.ts";

export const PIPELINE_PRODUCT_KEYS = ["store_id", "source_type", "page_no", "currency"] as const satisfies readonly LeafletProductKey[];

export const VERIFIED_PRODUCT_KEYS = LEAFLET_PRODUCT_KEYS.filter(
  (key) => !PIPELINE_PRODUCT_KEYS.includes(key as (typeof PIPELINE_PRODUCT_KEYS)[number]),
);

export type AiFieldStatus = "confirmed" | "verified_by_pass_3" | "unresolved";

export type AiFieldCheck = {
  status: AiFieldStatus;
  agreement: number;
};

export type AiChecks = {
  passes: 3;
  bbox: ProductBBox | null;
} & { [K in LeafletProductKey]: AiFieldCheck };

export type Pass3FieldDecision = {
  value: unknown;
  seen: boolean;
};

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.001;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b;
  return String(a).trim() === String(b).trim();
}

export function pipelineFieldCheck(): AiFieldCheck {
  return { status: "confirmed", agreement: 3 };
}

export function mergeVerifiedField(
  pass1: unknown,
  pass2: unknown,
  pass3: Pass3FieldDecision | undefined,
): { value: unknown; check: AiFieldCheck } {
  if (!pass3 || pass3.seen !== true) {
    return { value: null, check: { status: "unresolved", agreement: 0 } };
  }
  const final = pass3.value ?? null;
  const agreement = [pass1, pass2, final].filter((value) => valuesEqual(value, final)).length;
  if (agreement === 3) return { value: final, check: { status: "confirmed", agreement: 3 } };
  return { value: final, check: { status: "verified_by_pass_3", agreement } };
}

export function emptyAiChecks(bbox: ProductBBox | null): AiChecks {
  const fields = Object.fromEntries(LEAFLET_PRODUCT_KEYS.map((key) => [key, pipelineFieldCheck()])) as {
    [K in LeafletProductKey]: AiFieldCheck;
  };
  return { passes: 3, bbox, ...fields };
}

export type ThreePassOfferSummary = {
  products: number;
  fields_3_of_3: number;
  pass3_resolved_conflicts: number;
  needs_review: number;
  unresolved_fields: number;
};

export function summarizeThreePassOffers(
  rows: Array<{ ai_checks?: AiChecks | null; review_status?: string }>,
): ThreePassOfferSummary {
  const summary: ThreePassOfferSummary = {
    products: rows.length,
    fields_3_of_3: 0,
    pass3_resolved_conflicts: 0,
    needs_review: 0,
    unresolved_fields: 0,
  };
  for (const row of rows) {
    if (row.review_status === "needs_review") summary.needs_review += 1;
    const checks = row.ai_checks;
    if (!checks) continue;
    for (const key of VERIFIED_PRODUCT_KEYS) {
      const field = checks[key];
      if (!field) continue;
      if (field.status === "confirmed" && field.agreement === 3) summary.fields_3_of_3 += 1;
      if (field.status === "verified_by_pass_3") summary.pass3_resolved_conflicts += 1;
      if (field.status === "unresolved") summary.unresolved_fields += 1;
    }
  }
  return summary;
}

export function productFromPasses(
  pass1: LeafletProduct,
  merged: Partial<Record<LeafletProductKey, unknown>>,
): LeafletProduct {
  const out = { ...pass1, ...merged } as LeafletProduct;
  if (out.has_loyalty_card_price !== true) out.price_with_loyalty_card = null;
  return out;
}
