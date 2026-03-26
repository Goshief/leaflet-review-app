export const BATCH_ITEM_TABLES = ["offers_raw", "offers_quarantine"] as const;
export type BatchItemTable = (typeof BATCH_ITEM_TABLES)[number];

export type BatchItemEditablePatch = {
  extracted_name?: string | null;
  price_total?: number | null;
  currency?: string | null;
  pack_qty?: number | null;
  pack_unit?: string | null;
  pack_unit_qty?: number | null;
  price_standard?: number | null;
  typical_price_per_unit?: number | null;
  price_with_loyalty_card?: number | null;
  has_loyalty_card_price?: boolean | null;
  notes?: string | null;
  brand?: string | null;
  category?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  approved_image_key?: string | null;
  image_review_status?: "suggested" | "approved" | "rejected" | "manual_override" | null;
};

export const EDITABLE_BATCH_ITEM_FIELDS = [
  "extracted_name",
  "price_total",
  "currency",
  "pack_qty",
  "pack_unit",
  "pack_unit_qty",
  "price_standard",
  "typical_price_per_unit",
  "price_with_loyalty_card",
  "has_loyalty_card_price",
  "notes",
  "brand",
  "category",
  "valid_from",
  "valid_to",
  "approved_image_key",
  "image_review_status",
] as const;

const NUMBER_FIELDS = new Set<keyof BatchItemEditablePatch>([
  "price_total",
  "pack_qty",
  "pack_unit_qty",
  "price_standard",
  "typical_price_per_unit",
  "price_with_loyalty_card",
]);

const STRING_FIELDS = new Set<keyof BatchItemEditablePatch>([
  "extracted_name",
  "currency",
  "pack_unit",
  "notes",
  "brand",
  "category",
  "valid_from",
  "valid_to",
  "approved_image_key",
]);

const IMAGE_REVIEW_STATUSES = new Set<NonNullable<BatchItemEditablePatch["image_review_status"]>>([
  "suggested",
  "approved",
  "rejected",
  "manual_override",
]);

function asDateOnly(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export function isBatchItemTable(value: unknown): value is BatchItemTable {
  return typeof value === "string" && BATCH_ITEM_TABLES.includes(value as BatchItemTable);
}

export function sanitizeBatchItemPatch(value: unknown): BatchItemEditablePatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("patch musí být objekt");
  }
  const input = value as Record<string, unknown>;
  const out: BatchItemEditablePatch = {};

  for (const key of EDITABLE_BATCH_ITEM_FIELDS) {
    if (!(key in input)) continue;
    const raw = input[key];

    if (NUMBER_FIELDS.has(key)) {
      if (raw == null || raw === "") {
        (out as Record<string, unknown>)[key] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new Error(`Pole ${key} musí být číslo nebo null`);
      }
      (out as Record<string, unknown>)[key] = n;
      continue;
    }

    if (key === "has_loyalty_card_price") {
      if (raw == null) {
        out.has_loyalty_card_price = null;
        continue;
      }
      if (typeof raw !== "boolean") throw new Error("Pole has_loyalty_card_price musí být boolean");
      out.has_loyalty_card_price = raw;
      continue;
    }

    if (key === "valid_from" || key === "valid_to") {
      if (raw == null || raw === "") {
        (out as Record<string, unknown>)[key] = null;
        continue;
      }
      const d = asDateOnly(raw);
      if (!d) throw new Error(`Pole ${key} musí být datum YYYY-MM-DD nebo null`);
      (out as Record<string, unknown>)[key] = d;
      continue;
    }

    if (key === "image_review_status") {
      if (raw == null || raw === "") {
        out.image_review_status = null;
        continue;
      }
      const s = String(raw).trim() as NonNullable<BatchItemEditablePatch["image_review_status"]>;
      if (!IMAGE_REVIEW_STATUSES.has(s)) {
        throw new Error("Pole image_review_status musí být suggested|approved|rejected|manual_override nebo null");
      }
      out.image_review_status = s;
      continue;
    }

    if (STRING_FIELDS.has(key)) {
      if (raw == null) {
        (out as Record<string, unknown>)[key] = null;
        continue;
      }
      const s = String(raw).trim();
      (out as Record<string, unknown>)[key] = s || null;
    }
  }

  if (Object.keys(out).length === 0) {
    throw new Error("patch je prázdný");
  }
  return out;
}
