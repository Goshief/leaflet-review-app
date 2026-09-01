import type { OcrWord } from "./types.ts";
import { extractLeafletCandidates } from "../leaflet-review/extractor.ts";
import { applyPromoEvidence } from "../leaflet-review/promo-resolver.ts";
import { findPriceAnchors } from "./price-anchors.ts";
import { candidatesToLidlOffers, type LidlOfferWithOcrCrop } from "./to-lidl-offer.ts";
import { applyBillaStaging, parseLeafletHeaderDates } from "../leaflet/billa-staging.ts";

export type OcrPipelineResult = {
  ocr_words: OcrWord[];
  price_anchors: ReturnType<typeof findPriceAnchors>;
  offers: LidlOfferWithOcrCrop[];
};

function flipWordsYUp(words: OcrWord[]): {
  flipped: OcrWord[];
  maxY: number;
  minY: number;
} {
  const maxY = Math.max(...words.map((w) => w.y + w.h), 0);
  const minY = Math.min(...words.map((w) => w.y), 0);
  return {
    maxY,
    minY,
    flipped: words.map((w) => ({ ...w, y: maxY - (w.y + w.h) + minY })),
  };
}

function unflipBox(
  box: { x: number; y: number; width: number; height: number } | null,
  maxY: number,
  minY: number
): LidlOfferWithOcrCrop["ocr_crop_bbox"] {
  if (!box) return null;
  return {
    x: box.x,
    y: maxY - (box.y + box.height) + minY,
    w: box.width,
    h: box.height,
  };
}

/**
 * Image OCR (y dolů) → offer-raw extraktor (y nahoru jako PDF text).
 * Hlavní cena = velká prodejní cena, ne „100 ml = 17,37“.
 */
export function runOcrPipeline(
  words: OcrWord[],
  page_no: number | null,
  options?: { store_id?: string }
): OcrPipelineResult {
  if (words.length === 0) {
    return { ocr_words: words, price_anchors: [], offers: [] };
  }

  const { flipped, maxY, minY } = flipWordsYUp(words);
  const store_id = options?.store_id ?? "lidl";
  const pageText = words.map((w) => w.text).join(" ");
  const dates = parseLeafletHeaderDates(pageText);
  const candidates = extractLeafletCandidates(flipped, {
    pageNo: page_no ?? 1,
    validFrom: dates.valid_from,
    validTo: dates.valid_to,
  }).map((c) => applyPromoEvidence(c, flipped));

  const offers = applyBillaStaging(
    candidatesToLidlOffers(
      candidates,
      page_no,
      store_id,
      (c) => unflipBox(c.source_bbox, maxY, minY)
    ),
    {
      store_id,
      page_no,
      pageText,
      dates,
      words: flipped,
      layoutBoxes: candidates.map((c) => c.source_bbox),
    }
  );

  return {
    ocr_words: words,
    price_anchors: findPriceAnchors(words),
    offers,
  };
}
