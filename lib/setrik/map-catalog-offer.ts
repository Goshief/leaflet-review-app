export type SetrikPublicOffer = {
  id: string;
  name: string;
  store: string | null;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  price: number | null;
  regular_price: number | null;
  loyalty_price: number | null;
  currency: string;
  unit: string | null;
  valid_from: string | null;
  valid_to: string | null;
  image_url: string | null;
  product_url: string | null;
  source: string;
  created_at: string | null;
};

type AnyRow = Record<string, unknown>;

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Number(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function relatedProduct(value: unknown): AnyRow {
  if (Array.isArray(value)) return (value[0] as AnyRow | undefined) ?? {};
  return value && typeof value === "object" ? value as AnyRow : {};
}

function quantityLabel(product: AnyRow, row: AnyRow) {
  const unitPrice = num(row.unit_price);
  const unitBasis = str(row.unit_basis);
  if (unitPrice != null && unitBasis) return `${unitPrice.toLocaleString("cs-CZ")} Kč/${unitBasis}`;

  const quantity = num(product.quantity_value);
  const unit = str(product.quantity_unit);
  return quantity != null && unit ? `${quantity.toLocaleString("cs-CZ")} ${unit}` : null;
}

export function mapCatalogOfferRow(row: AnyRow): SetrikPublicOffer {
  const product = relatedProduct(row.retailer_products);
  const id = str(row.retailer_product_id) ?? str(product.id) ?? crypto.randomUUID();

  return {
    id,
    name: str(product.name) ?? "Produkt",
    store: str(row.retailer_id) ?? str(product.retailer_id),
    category: str(product.category),
    subcategory: null,
    brand: str(product.brand),
    price: num(row.price),
    regular_price: num(row.regular_price),
    loyalty_price: num(row.loyalty_price),
    currency: str(row.currency) ?? "CZK",
    unit: quantityLabel(product, row),
    valid_from: null,
    valid_to: null,
    image_url: str(product.image_url),
    product_url: str(row.source_url) ?? str(product.source_url),
    source: "web_catalog",
    created_at: str(row.observed_at) ?? str(row.updated_at) ?? str(product.last_seen_at),
  };
}
