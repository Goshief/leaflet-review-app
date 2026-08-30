import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { autoMatchRetailerProduct } from "@/lib/catalog-core/matcher";
import type { CatalogProduct } from "./types";

function pragueDate(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function offerFingerprint(product: CatalogProduct) {
  const value = JSON.stringify({
    price: product.offer.price,
    regular_price: product.offer.regularPrice,
    loyalty_price: product.offer.loyaltyPrice,
    unit_price: product.offer.unitPrice,
    unit_basis: product.offer.unitBasis,
    currency: product.offer.currency,
    available: product.offer.available,
  });
  return createHash("sha256").update(value).digest("hex");
}

export async function persistCatalogProduct(
  supabase: SupabaseClient,
  args: { product: CatalogProduct; fetchId: string; observedAt?: string }
) {
  const observedAt = args.observedAt ?? new Date().toISOString();
  const product = args.product;
  const { data: savedProduct, error: productError } = await supabase
    .from("retailer_products")
    .upsert(
      {
        retailer_id: product.retailerId,
        external_id: product.externalId,
        source_url: product.sourceUrl,
        name: product.name,
        brand: product.brand,
        sku: product.sku,
        gtin: product.gtin,
        quantity_value: product.quantityValue,
        quantity_unit: product.quantityUnit,
        image_url: product.imageUrl,
        category: product.category,
        country_of_origin: product.countryOfOrigin,
        metadata: product.metadata,
        last_fetch_id: args.fetchId,
        last_seen_at: observedAt,
        updated_at: observedAt,
      },
      { onConflict: "retailer_id,external_id" }
    )
    .select("id")
    .single();
  if (productError || !savedProduct?.id) {
    throw new Error(`retailer product persistence: ${productError?.message || "missing id"}`);
  }

  const retailerProductId = String(savedProduct.id);
  const fingerprint = offerFingerprint(product);
  const offerRow = {
    retailer_product_id: retailerProductId,
    retailer_id: product.retailerId,
    price: product.offer.price,
    regular_price: product.offer.regularPrice,
    loyalty_price: product.offer.loyaltyPrice,
    unit_price: product.offer.unitPrice,
    unit_basis: product.offer.unitBasis,
    currency: product.offer.currency,
    available: product.offer.available,
    source_url: product.sourceUrl,
    offer_fingerprint: fingerprint,
    observed_at: observedAt,
    updated_at: observedAt,
  };

  const { error: currentError } = await supabase
    .from("retailer_offers_current")
    .upsert(offerRow, { onConflict: "retailer_product_id" });
  if (currentError) throw new Error(`current offer persistence: ${currentError.message}`);

  const { error: historyError } = await supabase.from("retailer_price_observations").upsert(
    {
      retailer_product_id: retailerProductId,
      retailer_id: product.retailerId,
      observed_on: pragueDate(observedAt),
      observed_at: observedAt,
      price: product.offer.price,
      regular_price: product.offer.regularPrice,
      loyalty_price: product.offer.loyaltyPrice,
      unit_price: product.offer.unitPrice,
      unit_basis: product.offer.unitBasis,
      currency: product.offer.currency,
      available: product.offer.available,
      source_url: product.sourceUrl,
      offer_fingerprint: fingerprint,
    },
    { onConflict: "retailer_product_id,observed_on" }
  );
  if (historyError) throw new Error(`price history persistence: ${historyError.message}`);

  const match = await autoMatchRetailerProduct(supabase, retailerProductId);
  return { retailerProductId, fingerprint, observedAt, match };
}
