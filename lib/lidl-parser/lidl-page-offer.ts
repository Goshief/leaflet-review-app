/**
 * Striktní výstup: jedna stránka Lidl CZ letáku → řádky pro staging.
 */

export const LIDL_PAGE_OFFER_KEYS = [
  "store_id",
  "source_type",
  "page_no",
  "valid_from",
  "valid_to",
  "valid_from_text",
  "valid_to_text",
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
  "raw_text_block",
] as const;

export type LidlPageOfferKey = (typeof LIDL_PAGE_OFFER_KEYS)[number];

export type LidlPageOffer = {
  store_id: "lidl";
  source_type: "leaflet";
  page_no: number | null;
  valid_from: string | null;
  valid_to: string | null;
  valid_from_text: string | null;
  valid_to_text: string | null;
  extracted_name: string | null;
  price_total: number | null;
  currency: "CZK";
  pack_qty: number | null;
  pack_unit: string | null;
  pack_unit_qty: number | null;
  price_standard: number | null;
  typical_price_per_unit: number | null;
  price_with_loyalty_card: number | null;
  has_loyalty_card_price: boolean | null;
  notes: string | null;
  brand: string | null;
  category: string | null;
  raw_text_block: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function forbiddenNullString(v: unknown, path: string): string | undefined {
  if (v === "NULL" || v === "null") {
    return `${path}: nesmí být řetězec "NULL" ani "null", použij JSON null`;
  }
  return undefined;
}

function asNumberOrNull(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return NaN;
}

function asBooleanOrNull(v: unknown): boolean | null {
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  return null;
}

export function stripJsonArrayFromModelOutput(raw: string): string {
  let s = raw.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i;
  const m = s.match(fence);
  if (m) s = m[1].trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return s.trim();
}

function validateOne(
  obj: Record<string, unknown>,
  index: number
): { row: LidlPageOffer } | { errors: string[] } {
  const p = `[${index}]`;
  const errors: string[] = [];
  const keys = Object.keys(obj);
  for (const k of keys) {
    if (!LIDL_PAGE_OFFER_KEYS.includes(k as LidlPageOfferKey)) {
      errors.push(`${p}: nepovolené pole "${k}"`);
    }
  }
  for (const k of LIDL_PAGE_OFFER_KEYS) {
    if (!(k in obj)) errors.push(`${p}: chybí pole "${k}"`);
  }
  if (errors.length) return { errors };

  const store_id = obj.store_id;
  if (store_id !== "lidl") errors.push(`${p}: store_id musí být "lidl"`);

  const source_type = obj.source_type;
  if (source_type !== "leaflet")
    errors.push(`${p}: source_type musí být "leaflet"`);

  const currency = obj.currency;
  if (currency !== "CZK") errors.push(`${p}: currency musí být "CZK"`);

  const page_no = obj.page_no;
  if (page_no !== null && typeof page_no !== "number") {
    errors.push(`${p}: page_no musí být number nebo null`);
  }

  for (const field of ["valid_from", "valid_to"] as const) {
    const v = obj[field];
    if (v !== null && (typeof v !== "string" || !DATE_RE.test(v))) {
      errors.push(`${p}: ${field} musí být YYYY-MM-DD nebo null`);
    }
  }

  for (const field of [
    "valid_from_text",
    "valid_to_text",
    "extracted_name",
    "pack_unit",
    "notes",
    "brand",
    "category",
    "raw_text_block",
  ] as const) {
    const err = forbiddenNullString(obj[field], `${p}.${field}`);
    if (err) errors.push(err);
    if (obj[field] !== null && typeof obj[field] !== "string") {
      errors.push(`${p}: ${field} musí být string nebo null`);
    }
  }

  const numericFields = [
    "price_total",
    "pack_qty",
    "pack_unit_qty",
    "price_standard",
    "typical_price_per_unit",
    "price_with_loyalty_card",
  ] as const;
  for (const f of numericFields) {
    const n = asNumberOrNull(obj[f]);
    if (Number.isNaN(n)) errors.push(`${p}: ${f} musí být number nebo null`);
  }

  const has_loyalty = asBooleanOrNull(obj.has_loyalty_card_price);
  if (has_loyalty === null && obj.has_loyalty_card_price !== null) {
    errors.push(`${p}: has_loyalty_card_price musí být true, false nebo null`);
  }

  const pLoyal = obj.price_with_loyalty_card;
  if (has_loyalty !== true && pLoyal !== null) {
    errors.push(
      `${p}: price_with_loyalty_card musí být null, pokud has_loyalty_card_price není true`
    );
  }

  if (errors.length) return { errors };

  const row: LidlPageOffer = {
    store_id: "lidl",
    source_type: "leaflet",
    page_no: page_no as number | null,
    valid_from: obj.valid_from as string | null,
    valid_to: obj.valid_to as string | null,
    valid_from_text: obj.valid_from_text as string | null,
    valid_to_text: obj.valid_to_text as string | null,
    extracted_name: obj.extracted_name as string | null,
    price_total: obj.price_total as number | null,
    currency: "CZK",
    pack_qty: obj.pack_qty as number | null,
    pack_unit: obj.pack_unit as string | null,
    pack_unit_qty: obj.pack_unit_qty as number | null,
    price_standard: obj.price_standard as number | null,
    typical_price_per_unit: obj.typical_price_per_unit as number | null,
    price_with_loyalty_card: obj.price_with_loyalty_card as number | null,
    has_loyalty_card_price: has_loyalty,
    notes: obj.notes as string | null,
    brand: obj.brand as string | null,
    category: obj.category as string | null,
    raw_text_block: obj.raw_text_block as string | null,
  };

  return { row };
}

export type ParseLidlPageOffersResult =
  | { ok: true; offers: LidlPageOffer[] }
  | { ok: false; errors: string[] };

export type ParseLidlPageOffersOptions = {
  fillMissingNullKeys?: boolean;
};

function withNullDefaults(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const k of LIDL_PAGE_OFFER_KEYS) {
    if (!(k in out)) out[k] = null;
  }
  return out;
}

export function parseLidlPageOffersJson(
  text: string,
  options?: ParseLidlPageOffersOptions
): ParseLidlPageOffersResult {
  const fillMissing = options?.fillMissingNullKeys === true;
  let parsed: unknown;
  try {
    const cleaned = stripJsonArrayFromModelOutput(text);
    parsed = JSON.parse(cleaned);
  } catch {
    return { ok: false, errors: ["Neplatný JSON"] };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, errors: ["Kořen musí být JSON pole"] };
  }
  const offers: LidlPageOffer[] = [];
  const errors: string[] = [];
  parsed.forEach((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`[${index}]: položka musí být objekt`);
      return;
    }
    let rec = item as Record<string, unknown>;
    if (fillMissing) rec = withNullDefaults(rec);
    const r = validateOne(rec, index);
    if ("errors" in r) errors.push(...r.errors);
    else offers.push(r.row);
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, offers };
}
