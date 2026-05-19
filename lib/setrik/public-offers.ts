import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type SetrikPublicOffer = {
  id: string;
  name: string;
  store: string | null;
  category: string | null;
  brand: string | null;
  price: number | null;
  regular_price: number | null;
  loyalty_price: number | null;
  currency: string;
  unit: string | null;
  valid_from: string | null;
  valid_to: string | null;
  image_url: string | null;
  source: string;
  created_at: string | null;
};

export type SetrikPublicOffersResult =
  | {
      ok: true;
      configured: true;
      source_table: string;
      offers: SetrikPublicOffer[];
      total: number;
    }
  | {
      ok: true;
      configured: false;
      source_table: null;
      offers: [];
      total: 0;
      message: string;
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
    const normalized = v.replace(/\s/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function first<T>(...values: T[]): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function mapOfferRow(row: AnyRow, sourceTable: string): SetrikPublicOffer {
  const id = str(row.id) ?? crypto.randomUUID();
  const name =
    first(
      str(row.extracted_name),
      str(row.name),
      str(row.product_name),
      str(row.title),
      str(row.raw_text_block)
    ) ?? "Produkt";

  return {
    id,
    name,
    store: first(str(row.store_id), str(row.store), str(row.retailer), str(row.shop)),
    category: first(str(row.category), str(row.category_name)),
    brand: str(row.brand),
    price: first(num(row.price_total), num(row.price), num(row.current_price), num(row.action_price)),
    regular_price: first(num(row.price_standard), num(row.regular_price), num(row.original_price)),
    loyalty_price: first(num(row.price_with_loyalty_card), num(row.loyalty_price)),
    currency: first(str(row.currency), "CZK") ?? "CZK",
    unit: first(str(row.pack_unit), str(row.unit), str(row.package_unit)),
    valid_from: first(str(row.valid_from), str(row.date_from)),
    valid_to: first(str(row.valid_to), str(row.date_to)),
    image_url: first(str(row.image_url), str(row.image), str(row.thumbnail_url)),
    source: sourceTable,
    created_at: str(row.created_at),
  };
}

async function readTable(table: string, limit: number) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: new Error("Supabase není nakonfigurovaný.") };

  const orderColumn = table === "offers_raw" ? "created_at" : "created_at";
  return supabase.from(table).select("*").order(orderColumn, { ascending: false }).limit(limit);
}

export async function getSetrikPublicOffers(limit = 60): Promise<SetrikPublicOffersResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return {
      ok: true,
      configured: false,
      source_table: null,
      offers: [],
      total: 0,
      message:
        "Supabase není nakonfigurovaný. Nastav NEXT_PUBLIC_SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  const candidates = ["offers_raw", "products", "public_offers"];
  let lastError: string | null = null;

  for (const table of candidates) {
    const res = await readTable(table, limit);
    if (res.error) {
      lastError = res.error.message;
      continue;
    }

    const rows = Array.isArray(res.data) ? (res.data as AnyRow[]) : [];
    if (!rows.length) continue;

    const offers = rows.map((row) => mapOfferRow(row, table));
    return {
      ok: true,
      configured: true,
      source_table: table,
      offers,
      total: offers.length,
    };
  }

  console.warn("[setrik-public-offers] no rows found", { lastError });
  return {
    ok: true,
    configured: true,
    source_table: candidates[0],
    offers: [],
    total: 0,
  };
}
