const EDITABLE_PRODUCT_FIELDS = [
  "product_name",
  "brand",
  "variant",
  "pack_qty",
  "pack_unit",
  "pack_unit_qty",
  "pack_text",
  "price_sale",
  "price_standard",
  "price_loyalty",
  "price_without_loyalty",
  "price_per_unit",
  "price_per_unit_unit",
  "item_valid_from",
  "item_valid_to",
  "loyalty_required",
  "promo_label",
  "promo_condition",
  "minimum_quantity",
] as const;

export type EditableProductField = (typeof EDITABLE_PRODUCT_FIELDS)[number];

export function manualEditedKeys(fieldEvidence: unknown): EditableProductField[] {
  const fields =
    fieldEvidence && typeof fieldEvidence === "object"
      ? (fieldEvidence as { manual_edit?: { fields?: unknown } }).manual_edit?.fields
      : null;
  if (!Array.isArray(fields)) return [];
  return fields.filter(
    (key): key is EditableProductField =>
      typeof key === "string" && (EDITABLE_PRODUCT_FIELDS as readonly string[]).includes(key),
  );
}

/**
 * AI reread may refresh source text, but human-edited product fields stay.
 */
export function mergeRereadKeepingManualEdits<T extends Record<string, unknown>>(
  chosen: T,
  existing: { field_evidence?: unknown } & Record<string, unknown>,
): T {
  const keys = manualEditedKeys(existing.field_evidence);
  if (!keys.length) return chosen;

  const next = { ...chosen };
  for (const key of keys) {
    (next as Record<string, unknown>)[key] = existing[key];
  }

  const chosenEvidence =
    chosen.field_evidence && typeof chosen.field_evidence === "object"
      ? { ...(chosen.field_evidence as Record<string, unknown>) }
      : {};
  const existingEvidence =
    existing.field_evidence && typeof existing.field_evidence === "object"
      ? (existing.field_evidence as { manual_edit?: unknown })
      : {};
  (next as Record<string, unknown>).field_evidence = {
    ...chosenEvidence,
    manual_edit: existingEvidence.manual_edit,
  };
  (next as Record<string, unknown>).status = "unreviewed";
  return next;
}
