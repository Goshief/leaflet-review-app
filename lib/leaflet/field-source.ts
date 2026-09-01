import { LEAFLET_PRODUCT_KEYS, type LeafletProduct, type LeafletProductKey } from "./leaflet-product.ts";

export type FieldValueSource = "ai" | "human";

export type FieldSources = Record<LeafletProductKey, FieldValueSource>;

export type AiProposal = Partial<Record<LeafletProductKey, unknown>>;

export function emptyFieldSources(): FieldSources {
  return Object.fromEntries(LEAFLET_PRODUCT_KEYS.map((key) => [key, "ai"])) as FieldSources;
}

export function normalizeFieldSources(raw: unknown): FieldSources {
  const out = emptyFieldSources();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of LEAFLET_PRODUCT_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === "human" || value === "ai") out[key] = value;
  }
  return out;
}

export function fieldValuesEqual(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.001;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b;
  return String(a).trim() === String(b).trim();
}

export function markHumanEdits(
  previous: LeafletProduct,
  patch: Partial<LeafletProduct>,
  currentSources?: FieldSources | null,
): FieldSources {
  const sources = normalizeFieldSources(currentSources);
  for (const key of LEAFLET_PRODUCT_KEYS) {
    if (!(key in patch)) continue;
    if (!fieldValuesEqual(previous[key], patch[key])) sources[key] = "human";
  }
  return sources;
}

export type HumanProtectedMerge = {
  product: LeafletProduct;
  field_sources: FieldSources;
  ai_proposal: AiProposal;
  preserved_human_fields: LeafletProductKey[];
};

/**
 * AI may refresh AI-sourced fields. Human-sourced fields stay;
 * the new AI value is only stored as a proposal.
 */
export function mergeKeepingHumanFields(
  current: LeafletProduct,
  aiProduct: LeafletProduct,
  currentSources?: FieldSources | null,
): HumanProtectedMerge {
  const field_sources = normalizeFieldSources(currentSources);
  const product = { ...current };
  const ai_proposal: AiProposal = {};
  const preserved_human_fields: LeafletProductKey[] = [];

  for (const key of LEAFLET_PRODUCT_KEYS) {
    if (field_sources[key] === "human") {
      product[key] = current[key] as never;
      if (!fieldValuesEqual(current[key], aiProduct[key])) {
        ai_proposal[key] = aiProduct[key];
      }
      preserved_human_fields.push(key);
      continue;
    }
    product[key] = aiProduct[key] as never;
    field_sources[key] = "ai";
  }

  return { product, field_sources, ai_proposal, preserved_human_fields };
}
