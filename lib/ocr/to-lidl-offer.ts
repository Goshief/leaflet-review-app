import type { LidlPageOffer } from "../lidl-parser/lidl-page-offer.ts";
import type { ExtractedCandidate } from "../leaflet-review/extractor.ts";
import type { BBox } from "./types.ts";
import type { HeuristicProduct } from "./block-heuristic.ts";

/** Volitelný výřez pro náhled v adminu (pixely obrázku). */
export type LidlOfferWithOcrCrop = LidlPageOffer & {
  ocr_crop_bbox?: { x: number; y: number; w: number; h: number } | null;
};

const JUNK_NAME =
  /^(?:běžná|původní|cenazatkg|víkendových|hamburgerové|naše|cena|urquell|zbytek)$/i;

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

function cleanOfferName(name: string | null): string | null {
  const t = (name ?? "").replace(/\s+/g, " ").trim();
  if (!t || JUNK_NAME.test(t)) return null;
  return t;
}

function offerNotes(status: ExtractedCandidate["status"], name: string | null): string | null {
  if (name) return null;
  return status === "quarantine" ? "ambiguous title" : "unclear_name";
}

export function candidatesToLidlOffers(
  candidates: ExtractedCandidate[],
  page_no: number | null,
  store_id = "lidl",
  cropFromCandidate?: (c: ExtractedCandidate) => LidlOfferWithOcrCrop["ocr_crop_bbox"]
): LidlOfferWithOcrCrop[] {
  return candidates.map((c) => {
    const extracted_name = cleanOfferName(c.product_name);
    const hasLoyalty = c.loyalty_required === true;
    const box = c.source_bbox;
    const crop = cropFromCandidate
      ? cropFromCandidate(c)
      : box
        ? { x: box.x, y: box.y, w: box.width, h: box.height }
        : null;
    const row: LidlOfferWithOcrCrop = {
      store_id,
      source_type: "leaflet",
      page_no: c.page_no ?? page_no,
      valid_from: c.item_valid_from ?? c.leaflet_valid_from,
      valid_to: c.item_valid_to ?? c.leaflet_valid_to,
      valid_from_text: null,
      valid_to_text: null,
      extracted_name,
      price_total: c.price_sale,
      currency: "CZK",
      pack_qty: c.pack_qty,
      pack_unit: c.pack_unit,
      pack_unit_qty: c.pack_unit_qty,
      price_standard: c.price_standard,
      typical_price_per_unit: c.price_per_unit,
      price_with_loyalty_card: hasLoyalty ? c.price_loyalty : null,
      has_loyalty_card_price: hasLoyalty ? true : c.loyalty_required === false ? false : null,
      notes: offerNotes(c.status, extracted_name),
      brand: c.brand,
      category: null,
      raw_text_block: c.source_text ? c.source_text.slice(0, 2000) : null,
      ocr_crop_bbox: crop,
    };
    return row;
  });
}

export function heuristicToLidlOffers(
  items: Array<{
    heuristic: HeuristicProduct;
    crop: BBox | null;
  }>,
  page_no: number | null,
  store_id = "lidl"
): LidlOfferWithOcrCrop[] {
  return items.map(({ heuristic: h, crop }) => {
    const pack = parsePackFromUnit(h.unit);
    const extracted_name = cleanOfferName(h.name);
    const row: LidlOfferWithOcrCrop = {
      store_id,
      source_type: "leaflet",
      page_no,
      valid_from: null,
      valid_to: null,
      valid_from_text: null,
      valid_to_text: null,
      extracted_name,
      price_total: h.priceKc,
      currency: "CZK",
      pack_qty: pack.pack_qty,
      pack_unit: pack.pack_unit,
      pack_unit_qty: pack.pack_unit_qty,
      price_standard: null,
      typical_price_per_unit: null,
      price_with_loyalty_card: null,
      has_loyalty_card_price: null,
      notes: offerNotes(extracted_name ? "unreviewed" : "quarantine", extracted_name),
      brand: null,
      category: null,
      raw_text_block: h.blockText.slice(0, 2000),
      ocr_crop_bbox: crop ? bboxToClientRect(crop) : null,
    };
    return row;
  });
}
