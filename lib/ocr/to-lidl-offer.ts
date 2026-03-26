import type { LidlPageOffer } from "@/lib/lidl-parser";
import type { BBox } from "./types";
import type { HeuristicProduct } from "./block-heuristic";

/** Volitelný výřez pro náhled v adminu (pixely obrázku). */
export type LidlOfferWithOcrCrop = LidlPageOffer & {
  ocr_crop_bbox?: { x: number; y: number; w: number; h: number } | null;
};

function parsePackFromUnit(
  unit: string | null
): Pick<
  LidlPageOffer,
  "pack_qty" | "pack_unit" | "pack_unit_qty"
> {
  if (!unit) {
    return { pack_qty: null, pack_unit: null, pack_unit_qty: null };
  }
  const u = unit.replace(/\s+/g, " ").trim();
  const m = u.match(
    /(\d+(?:[.,]\d+)?)\s*(g|kg|ml|m[lL]|ks|kus)\b/i
  );
  if (!m) {
    return { pack_qty: null, pack_unit: null, pack_unit_qty: null };
  }
  const qty = parseFloat(m[1]!.replace(",", "."));
  if (!Number.isFinite(qty)) {
    return { pack_qty: null, pack_unit: null, pack_unit_qty: null };
  }
  let unitNorm = m[2]!.toLowerCase();
  if (unitNorm === "ml") unitNorm = "ml";
  return {
    pack_qty: 1,
    pack_unit: unitNorm,
    pack_unit_qty: qty,
  };
}

function bboxToClientRect(b: BBox): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  return {
    x: Math.max(0, b.x0),
    y: Math.max(0, b.y0),
    w: b.x1 - b.x0,
    h: b.y1 - b.y0,
  };
}

export function heuristicToLidlOffers(
  items: Array<{
    heuristic: HeuristicProduct;
    crop: BBox | null;
  }>,
  page_no: number | null
): LidlOfferWithOcrCrop[] {
  return items.map(({ heuristic: h, crop }) => {
    const pack = parsePackFromUnit(h.unit);
    const row: LidlOfferWithOcrCrop = {
      store_id: "lidl",
      source_type: "leaflet",
      page_no,
      valid_from: null,
      valid_to: null,
      valid_from_text: null,
      valid_to_text: null,
      extracted_name: h.name,
      price_total: h.priceKc,
      currency: "CZK",
      pack_qty: pack.pack_qty,
      pack_unit: pack.pack_unit,
      pack_unit_qty: pack.pack_unit_qty,
      price_standard: null,
      typical_price_per_unit: null,
      price_with_loyalty_card: null,
      has_loyalty_card_price: false,
      notes: h.badge,
      brand: null,
      category: null,
      raw_text_block: h.blockText.slice(0, 2000),
      ocr_crop_bbox: crop ? bboxToClientRect(crop) : null,
    };
    return row;
  });
}
