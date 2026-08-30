import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCatalogText } from "./matcher";

type Row = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function bool(value: unknown) {
  return value === true;
}

function effectivePublicPrice(row: Row) {
  return numberValue(row.price);
}

function discountPercent(price: number | null, regular: number | null) {
  if (price == null || regular == null || regular <= 0 || price >= regular) return 0;
  return Math.round((1 - price / regular) * 1000) / 10;
}

export type PublicRetailerOffer = {
  retailer_product_id: string;
  retailer: string;
  source_url: string | null;
  price: number | null;
  regular_price: number | null;
  loyalty_price: number | null;
  unit_price: number | null;
  unit_basis: string | null;
  currency: string;
  available: boolean;
  observed_at: string | null;
  discount_percent: number;
};

export type PublicCanonicalProduct = {
  id: string;
  name: string;
  brand: string | null;
  gtin: string | null;
  quantity_value: number | null;
  quantity_unit: string | null;
  category: string | null;
  subcategory: string | null;
  image_url: string | null;
  cheapest_price: number | null;
  cheapest_retailer: string | null;
  retailer_count: number;
  max_discount_percent: number;
  offers: PublicRetailerOffer[];
};

async function loadOffersForCanonicals(supabase: SupabaseClient, canonicalIds: string[]) {
  const byCanonical = new Map<string, PublicRetailerOffer[]>();
  if (!canonicalIds.length) return byCanonical;

  const { data: matches, error: matchesError } = await supabase
    .from("product_matches")
    .select("retailer_product_id,canonical_product_id")
    .in("canonical_product_id", canonicalIds);
  if (matchesError) throw new Error(`comparison match lookup: ${matchesError.message}`);
  const matchRows = (matches ?? []) as Row[];
  const retailerProductIds = [...new Set(matchRows.map((row) => text(row.retailer_product_id)).filter(Boolean))] as string[];
  if (!retailerProductIds.length) return byCanonical;

  const [{ data: products, error: productsError }, { data: offers, error: offersError }] = await Promise.all([
    supabase
      .from("retailer_products")
      .select("id,retailer_id,source_url")
      .in("id", retailerProductIds),
    supabase
      .from("retailer_offers_current")
      .select("retailer_product_id,retailer_id,price,regular_price,loyalty_price,unit_price,unit_basis,currency,available,source_url,observed_at")
      .in("retailer_product_id", retailerProductIds),
  ]);
  if (productsError) throw new Error(`comparison retailer product lookup: ${productsError.message}`);
  if (offersError) throw new Error(`comparison current offer lookup: ${offersError.message}`);

  const productMap = new Map((products ?? []).map((row: Row) => [text(row.id) ?? "", row]));
  const offerMap = new Map((offers ?? []).map((row: Row) => [text(row.retailer_product_id) ?? "", row]));
  const canonicalByRetailerProduct = new Map(
    matchRows.map((row) => [text(row.retailer_product_id) ?? "", text(row.canonical_product_id) ?? ""])
  );

  for (const retailerProductId of retailerProductIds) {
    const canonicalId = canonicalByRetailerProduct.get(retailerProductId);
    const product = productMap.get(retailerProductId);
    const offer = offerMap.get(retailerProductId);
    if (!canonicalId || !product || !offer) continue;
    const price = effectivePublicPrice(offer);
    const regular = numberValue(offer.regular_price);
    const publicOffer: PublicRetailerOffer = {
      retailer_product_id: retailerProductId,
      retailer: text(offer.retailer_id) ?? text(product.retailer_id) ?? "unknown",
      source_url: text(offer.source_url) ?? text(product.source_url),
      price,
      regular_price: regular,
      loyalty_price: numberValue(offer.loyalty_price),
      unit_price: numberValue(offer.unit_price),
      unit_basis: text(offer.unit_basis),
      currency: text(offer.currency) ?? "CZK",
      available: bool(offer.available),
      observed_at: text(offer.observed_at),
      discount_percent: discountPercent(price, regular),
    };
    const current = byCanonical.get(canonicalId) ?? [];
    current.push(publicOffer);
    byCanonical.set(canonicalId, current);
  }

  for (const offersForProduct of byCanonical.values()) {
    offersForProduct.sort((a, b) => {
      const ap = a.available && a.price != null ? a.price : Number.POSITIVE_INFINITY;
      const bp = b.available && b.price != null ? b.price : Number.POSITIVE_INFINITY;
      return ap - bp || a.retailer.localeCompare(b.retailer);
    });
  }
  return byCanonical;
}

function mapCanonical(row: Row, offers: PublicRetailerOffer[]): PublicCanonicalProduct {
  const available = offers.filter((offer) => offer.available && offer.price != null);
  const cheapest = available[0] ?? null;
  return {
    id: text(row.id) ?? "",
    name: text(row.name) ?? "Produkt",
    brand: text(row.brand),
    gtin: text(row.gtin),
    quantity_value: numberValue(row.quantity_value),
    quantity_unit: text(row.quantity_unit),
    category: text(row.category),
    subcategory: text(row.subcategory),
    image_url: text(row.image_url),
    cheapest_price: cheapest?.price ?? null,
    cheapest_retailer: cheapest?.retailer ?? null,
    retailer_count: new Set(available.map((offer) => offer.retailer)).size,
    max_discount_percent: available.reduce((max, offer) => Math.max(max, offer.discount_percent), 0),
    offers,
  };
}

export async function listCanonicalProducts(
  supabase: SupabaseClient,
  options?: {
    q?: string | null;
    brand?: string | null;
    category?: string | null;
    retailer?: string | null;
    discountedOnly?: boolean;
    limit?: number;
  }
) {
  const limit = Math.max(1, Math.min(100, Math.floor(options?.limit ?? 30)));
  let query = supabase
    .from("canonical_products")
    .select("id,name,normalized_name,brand,brand_normalized,gtin,quantity_value,quantity_unit,category,subcategory,image_url,updated_at")
    .order("updated_at", { ascending: false })
    .limit(Math.min(200, Math.max(limit * 3, limit)));

  const normalizedQuery = normalizeCatalogText(options?.q);
  if (normalizedQuery) query = query.ilike("normalized_name", `%${normalizedQuery}%`);
  const normalizedBrand = normalizeCatalogText(options?.brand);
  if (normalizedBrand) query = query.eq("brand_normalized", normalizedBrand);
  if (options?.category?.trim()) query = query.eq("category", options.category.trim());

  const { data, error } = await query;
  if (error) throw new Error(`canonical product list: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const ids = rows.map((row) => text(row.id)).filter(Boolean) as string[];
  const offerMap = await loadOffersForCanonicals(supabase, ids);

  let products = rows.map((row) => mapCanonical(row, offerMap.get(text(row.id) ?? "") ?? []));
  if (options?.retailer?.trim()) {
    const retailer = options.retailer.trim().toLowerCase();
    products = products.filter((product) => product.offers.some((offer) => offer.retailer.toLowerCase() === retailer));
  }
  if (options?.discountedOnly) products = products.filter((product) => product.max_discount_percent > 0);
  products.sort((a, b) => {
    const ap = a.cheapest_price ?? Number.POSITIVE_INFINITY;
    const bp = b.cheapest_price ?? Number.POSITIVE_INFINITY;
    return ap - bp || a.name.localeCompare(b.name, "cs");
  });
  return products.slice(0, limit);
}

export async function getCanonicalProductDetail(supabase: SupabaseClient, canonicalProductId: string) {
  const { data, error } = await supabase
    .from("canonical_products")
    .select("id,name,brand,gtin,quantity_value,quantity_unit,category,subcategory,image_url,metadata,updated_at")
    .eq("id", canonicalProductId)
    .maybeSingle();
  if (error) throw new Error(`canonical product detail: ${error.message}`);
  if (!data) return null;

  const offerMap = await loadOffersForCanonicals(supabase, [canonicalProductId]);
  const product = mapCanonical(data as Row, offerMap.get(canonicalProductId) ?? []);
  const retailerProductIds = product.offers.map((offer) => offer.retailer_product_id);
  let history: Array<{ date: string; min_price: number | null; average_price: number | null; retailer_count: number }> = [];

  if (retailerProductIds.length) {
    const since = new Date(Date.now() - 370 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: observations, error: historyError } = await supabase
      .from("retailer_price_observations")
      .select("retailer_product_id,retailer_id,observed_on,price,available")
      .in("retailer_product_id", retailerProductIds)
      .gte("observed_on", since)
      .order("observed_on", { ascending: true })
      .limit(10000);
    if (historyError) throw new Error(`canonical price history: ${historyError.message}`);

    const days = new Map<string, { prices: number[]; retailers: Set<string> }>();
    for (const row of (observations ?? []) as Row[]) {
      if (!bool(row.available)) continue;
      const date = text(row.observed_on);
      const price = numberValue(row.price);
      if (!date || price == null) continue;
      const day = days.get(date) ?? { prices: [], retailers: new Set<string>() };
      day.prices.push(price);
      const retailer = text(row.retailer_id);
      if (retailer) day.retailers.add(retailer);
      days.set(date, day);
    }
    history = [...days.entries()].map(([date, day]) => ({
      date,
      min_price: day.prices.length ? Math.min(...day.prices) : null,
      average_price: day.prices.length
        ? Math.round((day.prices.reduce((sum, price) => sum + price, 0) / day.prices.length) * 100) / 100
        : null,
      retailer_count: day.retailers.size,
    }));
  }

  return { ...product, history };
}

export async function getOffersForCanonicalIds(supabase: SupabaseClient, canonicalProductIds: string[]) {
  return loadOffersForCanonicals(supabase, canonicalProductIds);
}
