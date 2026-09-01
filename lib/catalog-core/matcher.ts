import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type MatchableProduct = {
  id?: string;
  name: string;
  brand?: string | null;
  gtin?: string | null;
  quantity_value?: number | string | null;
  quantity_unit?: string | null;
  category?: string | null;
  subcategory?: string | null;
  image_url?: string | null;
};

export type NormalizedIdentity = {
  normalizedName: string;
  brandNormalized: string | null;
  quantityBaseValue: number | null;
  quantityBaseUnit: "g" | "ml" | "piece" | null;
};

export type MatchScore = {
  total: number;
  name: number;
  brand: number;
  quantity: number;
  category: number;
};

const AUTO_THRESHOLD = 0.9;
const REVIEW_THRESHOLD = 0.68;

export function normalizeCatalogText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function finiteNumber(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeQuantity(value: number | string | null | undefined, unit: string | null | undefined) {
  const amount = finiteNumber(value);
  const normalizedUnit = normalizeCatalogText(unit);
  if (amount == null || !normalizedUnit) return { value: null, unit: null } as const;

  if (["kg", "kilogram", "kilogramu", "kilogramy"].includes(normalizedUnit)) {
    return { value: amount * 1000, unit: "g" as const };
  }
  if (["g", "gram", "gramu", "gramy"].includes(normalizedUnit)) {
    return { value: amount, unit: "g" as const };
  }
  if (["l", "litr", "litru", "litry"].includes(normalizedUnit)) {
    return { value: amount * 1000, unit: "ml" as const };
  }
  if (["ml", "mililitr", "mililitru", "mililitry"].includes(normalizedUnit)) {
    return { value: amount, unit: "ml" as const };
  }
  if (["ks", "kus", "kusu", "kusy", "piece"].includes(normalizedUnit)) {
    return { value: amount, unit: "piece" as const };
  }
  return { value: amount, unit: null } as const;
}

export function normalizedIdentity(product: MatchableProduct): NormalizedIdentity {
  const quantity = normalizeQuantity(product.quantity_value, product.quantity_unit);
  return {
    normalizedName: normalizeCatalogText(product.name),
    brandNormalized: normalizeCatalogText(product.brand) || null,
    quantityBaseValue: quantity.value,
    quantityBaseUnit: quantity.unit,
  };
}

function titleTokens(value: string, brand?: string | null) {
  const brandTokens = new Set(normalizeCatalogText(brand).split(" ").filter(Boolean));
  const ignored = new Set(["baleni", "baleni", "ks", "kus", "g", "kg", "ml", "l"]);
  return new Set(
    normalizeCatalogText(value)
      .split(" ")
      .filter((token) => token.length > 1 && !/^\d+$/.test(token) && !brandTokens.has(token) && !ignored.has(token))
  );
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function quantityScore(a: NormalizedIdentity, b: NormalizedIdentity) {
  if (a.quantityBaseValue == null || b.quantityBaseValue == null || !a.quantityBaseUnit || !b.quantityBaseUnit) return 0.5;
  if (a.quantityBaseUnit !== b.quantityBaseUnit) return 0;
  const max = Math.max(Math.abs(a.quantityBaseValue), Math.abs(b.quantityBaseValue), 1);
  const relative = Math.abs(a.quantityBaseValue - b.quantityBaseValue) / max;
  if (relative <= 0.01) return 1;
  if (relative <= 0.03) return 0.8;
  if (relative <= 0.1) return 0.25;
  return 0;
}

export function scoreProductIdentity(a: MatchableProduct, b: MatchableProduct): MatchScore {
  const ai = normalizedIdentity(a);
  const bi = normalizedIdentity(b);
  const name = jaccard(titleTokens(a.name, a.brand), titleTokens(b.name, b.brand));
  const brand = ai.brandNormalized && bi.brandNormalized
    ? ai.brandNormalized === bi.brandNormalized ? 1 : 0
    : 0.5;
  const quantity = quantityScore(ai, bi);
  const ac = normalizeCatalogText(a.category);
  const bc = normalizeCatalogText(b.category);
  const category = ac && bc ? (ac === bc ? 1 : 0) : 0.5;
  let total = name * 0.5 + brand * 0.25 + quantity * 0.2 + category * 0.05;

  if (ai.brandNormalized && bi.brandNormalized && ai.brandNormalized !== bi.brandNormalized) total = Math.min(total, 0.55);
  if (quantity === 0) total = Math.min(total, 0.6);

  return {
    total: Number(total.toFixed(4)),
    name: Number(name.toFixed(4)),
    brand,
    quantity,
    category,
  };
}

export function canonicalKey(product: MatchableProduct) {
  const identity = normalizedIdentity(product);
  const source = [
    identity.brandNormalized ?? "",
    identity.normalizedName,
    identity.quantityBaseValue ?? "",
    identity.quantityBaseUnit ?? "",
  ].join("|");
  return createHash("sha256").update(source).digest("hex");
}

function cleanGtin(gtin: string | null | undefined) {
  const digits = (gtin ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

async function saveLink(
  supabase: SupabaseClient,
  retailerProductId: string,
  canonicalProductId: string,
  method: "gtin" | "exact_key" | "scored" | "seed" | "manual",
  confidence: number,
  scoreBreakdown: Record<string, unknown> = {}
) {
  const { error } = await supabase.from("product_matches").upsert(
    {
      retailer_product_id: retailerProductId,
      canonical_product_id: canonicalProductId,
      method,
      confidence,
      score_breakdown: scoreBreakdown,
      status: method === "manual" ? "confirmed" : "auto",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "retailer_product_id" }
  );
  if (error) throw new Error(`product match persistence: ${error.message}`);
}

async function createOrGetCanonical(supabase: SupabaseClient, product: MatchableProduct) {
  const identity = normalizedIdentity(product);
  const key = canonicalKey(product);
  const gtin = cleanGtin(product.gtin);
  const row = {
    canonical_key: key,
    name: product.name,
    normalized_name: identity.normalizedName,
    brand: product.brand ?? null,
    brand_normalized: identity.brandNormalized,
    gtin,
    quantity_value: finiteNumber(product.quantity_value),
    quantity_unit: product.quantity_unit ?? null,
    quantity_base_value: identity.quantityBaseValue,
    quantity_base_unit: identity.quantityBaseUnit,
    category: product.category ?? null,
    subcategory: product.subcategory ?? null,
    image_url: product.image_url ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("canonical_products")
    .upsert(row, { onConflict: "canonical_key" })
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(`canonical product persistence: ${error?.message || "missing id"}`);
  return String(data.id);
}

async function candidateCanonicals(supabase: SupabaseClient, product: MatchableProduct) {
  const identity = normalizedIdentity(product);
  let query = supabase
    .from("canonical_products")
    .select("id,name,brand,gtin,quantity_value,quantity_unit,category,subcategory,image_url,canonical_key")
    .limit(120);
  if (identity.brandNormalized) {
    query = query.eq("brand_normalized", identity.brandNormalized);
  } else {
    const token = identity.normalizedName.split(" ").find((part) => part.length >= 4);
    if (token) query = query.ilike("normalized_name", `%${token}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`canonical candidate lookup: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function autoMatchRetailerProduct(supabase: SupabaseClient, retailerProductId: string) {
  const { data: productRow, error: productError } = await supabase
    .from("retailer_products")
    .select("id,name,brand,gtin,quantity_value,quantity_unit,category,image_url")
    .eq("id", retailerProductId)
    .single();
  if (productError || !productRow) throw new Error(`retailer product lookup for matching: ${productError?.message || "missing row"}`);
  const product = productRow as MatchableProduct;
  const gtin = cleanGtin(product.gtin);

  if (gtin) {
    const { data: gtinCanonical, error } = await supabase
      .from("canonical_products")
      .select("id")
      .eq("gtin", gtin)
      .maybeSingle();
    if (error) throw new Error(`GTIN canonical lookup: ${error.message}`);
    if (gtinCanonical?.id) {
      await saveLink(supabase, retailerProductId, String(gtinCanonical.id), "gtin", 1, { gtin });
      return { canonicalProductId: String(gtinCanonical.id), method: "gtin" as const, confidence: 1 };
    }
  }

  const key = canonicalKey(product);
  const { data: exact, error: exactError } = await supabase
    .from("canonical_products")
    .select("id")
    .eq("canonical_key", key)
    .maybeSingle();
  if (exactError) throw new Error(`canonical key lookup: ${exactError.message}`);
  if (exact?.id) {
    await saveLink(supabase, retailerProductId, String(exact.id), "exact_key", 0.99, { canonical_key: key });
    return { canonicalProductId: String(exact.id), method: "exact_key" as const, confidence: 0.99 };
  }

  const candidates = await candidateCanonicals(supabase, product);
  const scored = candidates
    .map((row) => ({ row, score: scoreProductIdentity(product, row as unknown as MatchableProduct) }))
    .sort((a, b) => b.score.total - a.score.total);
  const best = scored[0];
  const second = scored[1];

  if (best && best.score.total >= AUTO_THRESHOLD && (!second || best.score.total - second.score.total >= 0.04)) {
    const id = String(best.row.id);
    await saveLink(supabase, retailerProductId, id, "scored", best.score.total, best.score as unknown as Record<string, unknown>);
    return { canonicalProductId: id, method: "scored" as const, confidence: best.score.total };
  }

  const canonicalProductId = await createOrGetCanonical(supabase, product);
  await saveLink(supabase, retailerProductId, canonicalProductId, "seed", 1, { canonical_key: key });

  for (const candidate of scored.slice(0, 3)) {
    if (candidate.score.total < REVIEW_THRESHOLD || String(candidate.row.id) === canonicalProductId) continue;
    const { error } = await supabase.from("product_match_candidates").upsert(
      {
        retailer_product_id: retailerProductId,
        candidate_canonical_product_id: String(candidate.row.id),
        confidence: candidate.score.total,
        score_breakdown: candidate.score,
        status: "pending",
      },
      { onConflict: "retailer_product_id,candidate_canonical_product_id" }
    );
    if (error) throw new Error(`match candidate persistence: ${error.message}`);
  }

  return { canonicalProductId, method: "seed" as const, confidence: 1 };
}
