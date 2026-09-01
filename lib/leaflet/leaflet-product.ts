/**
 * Shared 21-field LeafletProduct contract. Alias of the existing LidlPageOffer shape.
 * Automatic parser validates with this Zod schema before any staging write.
 */
import { z } from "zod";
import {
  LIDL_PAGE_OFFER_KEYS,
  stripJsonArrayFromModelOutput,
  type LidlPageOffer,
} from "../lidl-parser/lidl-page-offer.ts";

export const LEAFLET_PRODUCT_KEYS = LIDL_PAGE_OFFER_KEYS;
export const LEAFLET_PRODUCT_FIELD_COUNT = LIDL_PAGE_OFFER_KEYS.length;

export type LeafletProduct = LidlPageOffer;
export type LeafletProductKey = (typeof LEAFLET_PRODUCT_KEYS)[number];

const STORE_ID_RE = /^[a-z][a-z0-9_-]{1,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const forbiddenNullString = z
  .string()
  .refine((value) => value !== "NULL" && value !== "null", {
    message: 'nesmí být řetězec "NULL" ani "null", použij JSON null',
  });

const textOrNull = z.union([z.null(), forbiddenNullString]);
const finiteOrNull = z.union([z.null(), z.number().finite()]);
const dateOrNull = z.union([z.null(), z.string().regex(DATE_RE, "musí být YYYY-MM-DD nebo null")]);

export const leafletProductSchema: z.ZodType<LeafletProduct> = z
  .strictObject({
    store_id: z.string().regex(STORE_ID_RE, "store_id musí být malý identifikátor (např. billa, lidl)"),
    source_type: z.literal("leaflet"),
    page_no: z.union([z.null(), z.number()]),
    valid_from: dateOrNull,
    valid_to: dateOrNull,
    valid_from_text: textOrNull,
    valid_to_text: textOrNull,
    extracted_name: textOrNull,
    price_total: finiteOrNull,
    currency: z.literal("CZK"),
    pack_qty: finiteOrNull,
    pack_unit: textOrNull,
    pack_unit_qty: finiteOrNull,
    price_standard: finiteOrNull,
    typical_price_per_unit: finiteOrNull,
    price_with_loyalty_card: finiteOrNull,
    has_loyalty_card_price: z.union([z.null(), z.boolean()]),
    notes: textOrNull,
    brand: textOrNull,
    category: textOrNull,
    raw_text_block: textOrNull,
  })
  .superRefine((row, ctx) => {
    if (row.has_loyalty_card_price !== true && row.price_with_loyalty_card !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["price_with_loyalty_card"],
        message: "price_with_loyalty_card musí být null, pokud has_loyalty_card_price není true",
      });
    }
  });

export type ParseLeafletProductsResult =
  | { ok: true; products: LeafletProduct[] }
  | { ok: false; errors: string[] };

export type ParseLeafletProductsOptions = {
  fillMissingNullKeys?: boolean;
};

function withNullDefaults(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const key of LEAFLET_PRODUCT_KEYS) {
    if (!(key in out)) out[key] = null;
  }
  return out;
}

/** Markdown table — never remap columns; fail the run. */
export function isMarkdownTablePayload(raw: string): boolean {
  const text = raw.trim();
  if (text.startsWith("[") || text.startsWith("{")) return false;
  const stripped = text.replace(/^```(?:markdown|md|table)?\s*/i, "").replace(/```$/, "").trim();
  if (stripped.startsWith("[") || stripped.startsWith("{")) return false;
  return /^\s*\|.+\|/m.test(stripped) && /\|[-: ]{3,}/.test(stripped);
}

function formatZodIssues(error: z.ZodError, index: number): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? `.${issue.path.join(".")}` : "";
    return `[${index}]${path}: ${issue.message}`;
  });
}

/**
 * Root must be a JSON array of named objects (the 21-field contract).
 * Positional arrays and Markdown tables are invalid — never column-shifted.
 */
export function parseLeafletProductsJson(
  text: string,
  options?: ParseLeafletProductsOptions,
): ParseLeafletProductsResult {
  if (isMarkdownTablePayload(text)) {
    return { ok: false, errors: ["Výstup je Markdown tabulka. Očekáván JSON seznam objektů LeafletProduct."] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonArrayFromModelOutput(text));
  } catch {
    return { ok: false, errors: ["Neplatný JSON"] };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, errors: ["Kořen musí být JSON pole objektů"] };
  }

  const fillMissing = options?.fillMissingNullKeys === true;
  const products: LeafletProduct[] = [];
  const errors: string[] = [];

  parsed.forEach((item, index) => {
    if (item === null || typeof item !== "object") {
      errors.push(`[${index}]: položka musí být objekt`);
      return;
    }
    if (Array.isArray(item)) {
      errors.push(`[${index}]: položka musí být JSON objekt, ne poziční pole`);
      return;
    }
    const rec = fillMissing ? withNullDefaults(item as Record<string, unknown>) : (item as Record<string, unknown>);
    const result = leafletProductSchema.safeParse(rec);
    if (!result.success) {
      errors.push(...formatZodIssues(result.error, index));
      return;
    }
    products.push(result.data);
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, products };
}
