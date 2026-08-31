import { extractLeafletCandidates } from "./extractor.ts";
import { applyPromoEvidence } from "./promo-resolver.ts";
import { candidatesToLidlOffers, type LidlOfferWithOcrCrop } from "../ocr/to-lidl-offer.ts";
import { findPriceAnchors } from "../ocr/price-anchors.ts";
import type { OcrWord } from "../ocr/types.ts";

export type PdfTextParseResult = {
  offers: LidlOfferWithOcrCrop[];
  word_count: number;
  price_anchors: ReturnType<typeof findPriceAnchors>;
  model: string;
};

/**
 * PDF text layer (y nahoru, výška = font) → offer-raw řádky.
 * Stejný extraktor jako processLeafletPdf / dávky. Bez Tesseractu, bez otočení Y.
 */
export function parseLeafletPageFromPdfText(
  words: OcrWord[],
  page_no: number | null,
  store_id = "lidl"
): PdfTextParseResult {
  const pageNo = page_no ?? 1;
  const candidates = extractLeafletCandidates(words, {
    pageNo,
    validFrom: null,
    validTo: null,
  }).map((c) => applyPromoEvidence(c, words));

  return {
    offers: candidatesToLidlOffers(candidates, page_no, store_id, () => null),
    word_count: words.length,
    price_anchors: findPriceAnchors(words),
    model: "pdf-text + leaflet-layout extractor",
  };
}
