import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type ShopperHomepageProduct = {
  id: string;
  name: string;
  detail: string | null;
  store: string;
  validTo: string | null;
  price: number;
  regularPrice: number | null;
  loyaltyPrice: number | null;
  hasLoyaltyPrice: boolean;
  unitPrice: number | null;
  badge: string | null;
  imageUrl: string | null;
};

export type HomepageDataQuality = {
  totalRows: number;
  withPriceStandard: number;
  withLoyaltyFlagTrue: number;
  withApprovedImageKey: number;
};

const imagePool = ["/mockup/thumb-1.svg", "/mockup/thumb-2.svg", "/mockup/thumb-3.svg"];

const templateProducts: ShopperHomepageProduct[] = [
  { id: "tpl-1", name: "Banány TKL", detail: null, store: "Kaufland", validTo: null, price: 27, regularPrice: null, loyaltyPrice: null, hasLoyaltyPrice: false, unitPrice: null, badge: null, imageUrl: imagePool[0] },
  { id: "tpl-2", name: "Apetito", detail: "tavený sýr 100g", store: "Lidl", validTo: null, price: 39, regularPrice: 65, loyaltyPrice: 39, hasLoyaltyPrice: true, unitPrice: null, badge: "-40%", imageUrl: imagePool[1] },
  { id: "tpl-3", name: "Coca-Cola", detail: "2L", store: "Tesco", validTo: null, price: 25, regularPrice: null, loyaltyPrice: null, hasLoyaltyPrice: false, unitPrice: null, badge: null, imageUrl: imagePool[2] },
  { id: "tpl-4", name: "Cerea", detail: "1,5L", store: "Penny", validTo: null, price: 14, regularPrice: null, loyaltyPrice: null, hasLoyaltyPrice: false, unitPrice: null, badge: null, imageUrl: imagePool[0] },
  { id: "tpl-5", name: "Jahody", detail: "250g", store: "Billa", validTo: null, price: 31, regularPrice: 39, loyaltyPrice: 31, hasLoyaltyPrice: true, unitPrice: null, badge: "-20%", imageUrl: imagePool[1] },
  { id: "tpl-6", name: "Olma mléko", detail: null, store: "Albert", validTo: null, price: 28, regularPrice: 36, loyaltyPrice: 28, hasLoyaltyPrice: true, unitPrice: null, badge: "-22%", imageUrl: imagePool[2] },
  { id: "tpl-7", name: "Tesco Hermelín", detail: "120g", store: "Tesco", validTo: null, price: 24, regularPrice: null, loyaltyPrice: null, hasLoyaltyPrice: false, unitPrice: null, badge: null, imageUrl: imagePool[0] },
  { id: "tpl-8", name: "Rama Classic", detail: "400g", store: "Kaufland", validTo: null, price: 27, regularPrice: null, loyaltyPrice: null, hasLoyaltyPrice: false, unitPrice: null, badge: null, imageUrl: imagePool[1] },
  { id: "tpl-9", name: "Pilsner Urquell", detail: "6x0,5l", store: "Lidl", validTo: null, price: 94, regularPrice: null, loyaltyPrice: null, hasLoyaltyPrice: false, unitPrice: null, badge: null, imageUrl: imagePool[2] },
  { id: "tpl-10", name: "Papriky mix", detail: "500g", store: "Penny", validTo: null, price: 45, regularPrice: 64, loyaltyPrice: 45, hasLoyaltyPrice: true, unitPrice: null, badge: "-30%", imageUrl: imagePool[0] },
  { id: "tpl-11", name: "Kinder Bueno", detail: null, store: "Billa", validTo: null, price: 21, regularPrice: 29, loyaltyPrice: null, hasLoyaltyPrice: false, unitPrice: null, badge: "-8 Kč", imageUrl: imagePool[1] },
  { id: "tpl-12", name: "Florian jogurt", detail: null, store: "Albert", validTo: null, price: 12, regularPrice: 15, loyaltyPrice: 12, hasLoyaltyPrice: true, unitPrice: null, badge: "-20%", imageUrl: imagePool[2] },
  { id: "tpl-13", name: "Kuřecí prsa", detail: "1kg", store: "Tesco", validTo: null, price: 159, regularPrice: 182, loyaltyPrice: null, hasLoyaltyPrice: false, unitPrice: null, badge: "-23 Kč", imageUrl: imagePool[0] },
  { id: "tpl-14", name: "Chléb Šumava", detail: null, store: "Penny", validTo: null, price: 32, regularPrice: null, loyaltyPrice: null, hasLoyaltyPrice: false, unitPrice: null, badge: null, imageUrl: imagePool[1] },
  { id: "tpl-15", name: "Whiskas kapsička", detail: "4x100g", store: "Kaufland", validTo: null, price: 75, regularPrice: 87, loyaltyPrice: null, hasLoyaltyPrice: false, unitPrice: null, badge: "-12 Kč", imageUrl: imagePool[2] },
];

function toPrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(",", ".").trim();
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fmtDate(value: string | null): string | null {
  if (!value) return null;
  return value;
}

export async function getShopperHomepageData() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return {
      products: templateProducts,
      source: "template" as const,
      activeProducts: templateProducts.length,
      dataQuality: null as HomepageDataQuality | null,
    };
  }

  const r = await supabase
    .from("offers_raw")
    .select(
      "id,store_id,valid_to,extracted_name,price_total,price_standard,price_with_loyalty_card,has_loyalty_card_price,typical_price_per_unit,pack_qty,pack_unit,notes"
    )
    .not("price_total", "is", null)
    .order("created_at", { ascending: false })
    .limit(800);

  if (r.error || !r.data) {
    return {
      products: templateProducts,
      source: "template" as const,
      activeProducts: templateProducts.length,
      dataQuality: null as HomepageDataQuality | null,
    };
  }

  const fromDb = r.data
    .map((x, i) => {
      const price = toPrice(x.price_total);
      if (price == null) return null;
      const regularPrice = toPrice(x.price_standard);
      const loyaltyPrice = toPrice(x.price_with_loyalty_card);
      const hasLoyaltyPrice = x.has_loyalty_card_price === true && loyaltyPrice != null;
      const unitPrice = toPrice(x.typical_price_per_unit);
      const badge =
        regularPrice != null && regularPrice > price
          ? `-${Math.round(((regularPrice - price) / regularPrice) * 100)}%`
          : hasLoyaltyPrice
            ? "S kartou"
            : null;

      return {
        id: String(x.id),
        name: String(x.extracted_name ?? "").trim() || "Produkt",
        detail:
          x.pack_qty && x.pack_unit
            ? `${x.pack_qty}${x.pack_unit}`
            : typeof x.notes === "string" && x.notes.trim()
              ? x.notes.trim().slice(0, 30)
              : null,
        store: String(x.store_id ?? "Obchod"),
        validTo: fmtDate(x.valid_to as string | null),
        price,
        regularPrice,
        loyaltyPrice,
        hasLoyaltyPrice,
        unitPrice,
        badge,
        imageUrl: imagePool[i % imagePool.length] ?? null,
      } satisfies ShopperHomepageProduct;
    })
    .filter((x): x is ShopperHomepageProduct => Boolean(x));

  const [totalRows, withPriceStandard, withLoyaltyFlagTrue, withApprovedImageKey] = await Promise.all([
    supabase.from("offers_raw").select("*", { count: "exact", head: true }),
    supabase.from("offers_raw").select("*", { count: "exact", head: true }).not("price_standard", "is", null),
    supabase.from("offers_raw").select("*", { count: "exact", head: true }).eq("has_loyalty_card_price", true),
    supabase.from("offers_raw").select("*", { count: "exact", head: true }).not("approved_image_key", "is", null),
  ]);
  const dataQuality: HomepageDataQuality = {
    totalRows: totalRows.count ?? 0,
    withPriceStandard: withPriceStandard.count ?? 0,
    withLoyaltyFlagTrue: withLoyaltyFlagTrue.count ?? 0,
    withApprovedImageKey: withApprovedImageKey.count ?? 0,
  };

  if (!fromDb.length) {
    return {
      products: templateProducts,
      source: "template" as const,
      activeProducts: templateProducts.length,
      dataQuality,
    };
  }

  const padded = [...fromDb.slice(0, 430)];
  while (padded.length < 430) {
    const t = templateProducts[padded.length % templateProducts.length]!;
    padded.push({ ...t, id: `${t.id}-fallback-${padded.length}` });
  }

  return { products: padded, source: "supabase" as const, activeProducts: fromDb.length, dataQuality };
}
