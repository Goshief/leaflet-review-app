import { getSupabaseAdmin } from "@/lib/supabase/admin";

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

type CategoryGuess = {
  category: string;
  subcategory: string;
};

const QUERY_TIMEOUT_MS = 4000;

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

function normalizeText(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matches(value: string, pattern: RegExp) {
  return pattern.test(value);
}

function inferCategory(name: string | null, brand: string | null): CategoryGuess | null {
  const text = normalizeText(`${name ?? ""} ${brand ?? ""}`);

  if (matches(text, /\b(mleko|polotucne|plnotucne)\b/)) return { category: "Mléčné výrobky", subcategory: "Mléko" };
  if (matches(text, /\b(maslo)\b/)) return { category: "Mléčné výrobky", subcategory: "Máslo" };
  if (matches(text, /\b(jogurt|jogurty)\b/)) return { category: "Mléčné výrobky", subcategory: "Jogurty" };
  if (matches(text, /\b(syr|eidam|gouda|niva)\b/)) return { category: "Mléčné výrobky", subcategory: "Sýry" };
  if (matches(text, /\b(sul|horcice|kecup|ketchup)\b/)) return { category: "Potraviny", subcategory: "Dochucovadla" };
  if (matches(text, /\b(testoviny|penne|spagety|ryze)\b/)) return { category: "Potraviny", subcategory: "Těstoviny a rýže" };
  if (matches(text, /\b(mouka|cukr|krupice|strouhanka)\b/)) return { category: "Potraviny", subcategory: "Mouka a pečení" };
  if (matches(text, /\b(fazole|kukurice|konzerv)\b/)) return { category: "Potraviny", subcategory: "Konzervy" };
  if (matches(text, /\b(tunak|losos|sardinky)\b/)) return { category: "Ryby", subcategory: "Rybí konzervy" };
  if (matches(text, /\b(pastika)\b/)) return { category: "Masné výrobky", subcategory: "Paštiky" };
  if (matches(text, /\b(caj)\b/)) return { category: "Káva a čaj", subcategory: "Čaj" };
  if (matches(text, /\b(kava)\b/)) return { category: "Káva a čaj", subcategory: "Káva" };
  if (matches(text, /\b(olej)\b/)) return { category: "Potraviny", subcategory: "Oleje" };
  if (matches(text, /\b(ovesne vlocky|vlocky|cerealie|cornflakes|lupinky)\b/)) return { category: "Snídaně", subcategory: "Cereálie" };
  if (matches(text, /\b(banan|banany|jablko|jablka|citron|citrusy)\b/)) return { category: "Ovoce a zelenina", subcategory: "Ovoce" };
  if (matches(text, /\b(rajcata|rajce|brambory|mrkev|cibule|brokolice|salat)\b/)) return { category: "Ovoce a zelenina", subcategory: "Zelenina" };
  if (matches(text, /\b(chleb|rohlik|housky|pecivo)\b/)) return { category: "Pečivo", subcategory: "Pečivo" };

  return null;
}

function isBadMilkFallback(category: string | null, subcategory: string | null, name: string | null) {
  const cat = normalizeText(category);
  const sub = normalizeText(subcategory);
  const product = normalizeText(name);
  const looksLikeMilkBucket = (cat === "mlecne vyrobky" || cat === "mlecne") && (sub === "trvanlive mleko" || sub === "mleko");
  const reallyMilk = /\b(mleko|polotucne|plnotucne)\b/.test(product);
  return looksLikeMilkBucket && !reallyMilk;
}

function mapOfferRow(row: AnyRow, sourceTable: string): SetrikPublicOffer {
  const id = str(row.id) ?? crypto.randomUUID();
  const name = first(str(row.product_name), str(row.extracted_name), str(row.name), str(row.title), str(row.raw_text_block)) ?? "Produkt";
  const brand = str(row.brand);
  const guessed = inferCategory(name, brand);
  const rawCategory = first(str(row.category_canonical), str(row.category), str(row.category_name));
  const rawSubcategory = first(str(row.subcategory_canonical), str(row.subcategory), str(row.subcategory_name));
  const shouldOverrideBadFallback = isBadMilkFallback(rawCategory, rawSubcategory, name);
  const category = guessed?.category ?? (shouldOverrideBadFallback ? "Nezařazeno" : rawCategory);
  const subcategory = guessed?.subcategory ?? (shouldOverrideBadFallback ? "Ostatní" : rawSubcategory);

  return {
    id,
    name,
    store: first(str(row.store_id), str(row.store), str(row.retailer), str(row.shop)),
    category,
    subcategory,
    brand,
    price: first(num(row.price_total), num(row.price), num(row.current_price), num(row.action_price)),
    regular_price: first(num(row.price_standard), num(row.regular_price), num(row.original_price)),
    loyalty_price: first(num(row.price_with_loyalty_card), num(row.loyalty_price)),
    currency: first(str(row.currency), "CZK") ?? "CZK",
    unit: first(str(row.normalized_price_unit), str(row.unit_price_unit), str(row.pack_unit), str(row.unit), str(row.package_unit)),
    valid_from: first(str(row.valid_from), str(row.date_from)),
    valid_to: first(str(row.valid_to), str(row.date_to)),
    image_url: first(str(row.image_url), str(row.image), str(row.thumbnail_url)),
    source: sourceTable,
    created_at: first(str(row.inserted_at), str(row.created_at)),
  };
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs = QUERY_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readHomepageView(table: string, limit: number) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: new Error("Supabase není nakonfigurovaný.") };

  const today = todayIsoDate();
  const result = await withTimeout(
    supabase.from(table).select("*").gte("valid_to", today).or(`valid_from.is.null,valid_from.lte.${today}`).limit(limit)
  );
  return result ?? { data: null, error: new Error(`Timeout při čtení ${table}.`) };
}

async function readOffersRaw(limit: number) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { data: null, error: new Error("Supabase není nakonfigurovaný.") };

  const today = todayIsoDate();
  const result = await withTimeout(
    supabase
      .from("offers_raw")
      .select("id,store_id,extracted_name,brand,category,subcategory,category_canonical,subcategory_canonical,price_total,price_standard,price_after_sale,price_with_loyalty_card,has_loyalty_card_price,currency,pack_unit,unit_price_value,unit_price_unit,normalized_price,normalized_price_unit,image_url,image_alt,valid_from,valid_to,review_status,price_public_blocked,inserted_at,created_at")
      .gte("valid_to", today)
      .or(`valid_from.is.null,valid_from.lte.${today}`)
      .eq("price_public_blocked", false)
      .eq("review_status", "ok")
      .not("extracted_name", "is", null)
      .order("inserted_at", { ascending: false })
      .limit(limit)
  );
  return result ?? { data: null, error: new Error("Timeout při čtení offers_raw.") };
}

export async function getSetrikPublicOffers(limit = 120): Promise<SetrikPublicOffersResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return {
      ok: true,
      configured: false,
      source_table: null,
      offers: [],
      total: 0,
      message: "Supabase není nakonfigurovaný. Nastav NEXT_PUBLIC_SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  const candidates = ["homepage_products_frontend", "active_products_frontend"];
  let lastError: string | null = null;

  for (const table of candidates) {
    const res = await readHomepageView(table, limit);
    if (res.error) {
      lastError = res.error.message;
      continue;
    }

    const rows = Array.isArray(res.data) ? (res.data as AnyRow[]) : [];
    if (!rows.length) continue;

    const offers = rows.map((row) => mapOfferRow(row, table));
    return { ok: true, configured: true, source_table: table, offers, total: offers.length };
  }

  const rawRes = await readOffersRaw(limit);
  if (rawRes.error) {
    lastError = rawRes.error.message;
  } else {
    const rows = Array.isArray(rawRes.data) ? (rawRes.data as AnyRow[]) : [];
    if (rows.length) {
      const offers = rows.map((row) => mapOfferRow(row, "offers_raw"));
      return { ok: true, configured: true, source_table: "offers_raw", offers, total: offers.length };
    }
  }

  console.warn("[setrik-public-offers] no active product rows found", { lastError });
  return { ok: true, configured: true, source_table: "offers_raw", offers: [], total: 0 };
}
