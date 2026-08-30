import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCatalogText } from "./matcher";
import { getOffersForCanonicalIds } from "./repository";

type Row = Record<string, unknown>;

type ConstraintValue = string | number | boolean;

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function attributes(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sameValue(actual: unknown, expected: ConstraintValue) {
  if (typeof expected === "number") return Number(actual) === expected;
  if (typeof expected === "boolean") return actual === expected || String(actual).toLowerCase() === String(expected);
  return normalizeCatalogText(String(actual ?? "")) === normalizeCatalogText(expected);
}

export function matchesSmartProductConstraints(attrs: Record<string, unknown>, constraints: Record<string, ConstraintValue>) {
  return Object.entries(constraints).every(([key, expected]) => sameValue(attrs[key], expected));
}

export async function listSmartProducts(
  supabase: SupabaseClient,
  options?: { q?: string | null; category?: string | null; limit?: number }
) {
  const limit = Math.max(1, Math.min(100, Math.floor(options?.limit ?? 30)));
  let query = supabase
    .from("generic_products")
    .select("id,slug,name,normalized_name,category,description,default_constraints,metadata")
    .eq("active", true)
    .order("name")
    .limit(limit);
  const q = normalizeCatalogText(options?.q);
  if (q) query = query.ilike("normalized_name", `%${q}%`);
  if (options?.category?.trim()) query = query.eq("category", options.category.trim());
  const { data, error } = await query;
  if (error) throw new Error(`smart product list: ${error.message}`);
  return (data ?? []).map((row: Row) => ({
    id: text(row.id),
    slug: text(row.slug),
    name: text(row.name) ?? "Chytrý produkt",
    category: text(row.category),
    description: text(row.description),
    default_constraints: attributes(row.default_constraints),
  }));
}

export async function getSmartProductDetail(
  supabase: SupabaseClient,
  idOrSlug: string,
  constraints: Record<string, ConstraintValue> = {}
) {
  let genericQuery = supabase
    .from("generic_products")
    .select("id,slug,name,category,description,default_constraints,metadata")
    .eq("active", true);
  genericQuery = /^[0-9a-f-]{36}$/i.test(idOrSlug)
    ? genericQuery.eq("id", idOrSlug)
    : genericQuery.eq("slug", idOrSlug);
  const { data: generic, error } = await genericQuery.maybeSingle();
  if (error) throw new Error(`smart product detail: ${error.message}`);
  if (!generic) return null;

  const genericId = text((generic as Row).id) ?? "";
  const { data: members, error: memberError } = await supabase
    .from("generic_product_members")
    .select("canonical_product_id,attributes")
    .eq("generic_product_id", genericId)
    .eq("enabled", true);
  if (memberError) throw new Error(`smart product members: ${memberError.message}`);

  const filteredMembers = ((members ?? []) as Row[]).filter((row) =>
    matchesSmartProductConstraints(attributes(row.attributes), constraints)
  );
  const canonicalIds = filteredMembers.map((row) => text(row.canonical_product_id)).filter(Boolean) as string[];
  if (!canonicalIds.length) {
    return {
      id: genericId,
      slug: text((generic as Row).slug),
      name: text((generic as Row).name) ?? "Chytrý produkt",
      category: text((generic as Row).category),
      description: text((generic as Row).description),
      constraints,
      variants: [],
      cheapest: null,
    };
  }

  const [{ data: canonicals, error: canonicalError }, offerMap] = await Promise.all([
    supabase
      .from("canonical_products")
      .select("id,name,brand,quantity_value,quantity_unit,image_url,category")
      .in("id", canonicalIds),
    getOffersForCanonicalIds(supabase, canonicalIds),
  ]);
  if (canonicalError) throw new Error(`smart product canonical lookup: ${canonicalError.message}`);
  const canonicalMap = new Map(((canonicals ?? []) as Row[]).map((row) => [text(row.id) ?? "", row]));

  const variants = filteredMembers.map((member) => {
    const canonicalId = text(member.canonical_product_id) ?? "";
    const canonical = canonicalMap.get(canonicalId) ?? {};
    const offers = (offerMap.get(canonicalId) ?? []).filter((offer) => offer.available && offer.price != null);
    const cheapest = offers[0] ?? null;
    return {
      canonical_product_id: canonicalId,
      name: text(canonical.name) ?? "Produkt",
      brand: text(canonical.brand),
      quantity_value: canonical.quantity_value == null ? null : Number(canonical.quantity_value),
      quantity_unit: text(canonical.quantity_unit),
      image_url: text(canonical.image_url),
      attributes: attributes(member.attributes),
      cheapest_offer: cheapest,
    };
  }).sort((a, b) => {
    const ap = a.cheapest_offer?.price ?? Number.POSITIVE_INFINITY;
    const bp = b.cheapest_offer?.price ?? Number.POSITIVE_INFINITY;
    return ap - bp || a.name.localeCompare(b.name, "cs");
  });

  return {
    id: genericId,
    slug: text((generic as Row).slug),
    name: text((generic as Row).name) ?? "Chytrý produkt",
    category: text((generic as Row).category),
    description: text((generic as Row).description),
    constraints,
    variants,
    cheapest: variants.find((variant) => variant.cheapest_offer) ?? null,
  };
}
