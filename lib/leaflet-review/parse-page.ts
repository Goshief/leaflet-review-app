import { extractLeafletCandidates } from "./extractor.ts";
import { applyPromoEvidence } from "./promo-resolver.ts";
import { candidatesToLidlOffers, type LidlOfferWithOcrCrop } from "../ocr/to-lidl-offer.ts";
import { findPriceAnchors } from "../ocr/price-anchors.ts";
import type { OcrWord } from "../ocr/types.ts";
import { applyBillaStaging, parseLeafletHeaderDates } from "../leaflet/billa-staging.ts";

export type PdfTextParseResult = {
  offers: LidlOfferWithOcrCrop[];
  word_count: number;
  price_anchors: ReturnType<typeof findPriceAnchors>;
  model: string;
};

/**
 * PDF text layer (y nahoru, výška = font) → 21polové offer-raw řádky.
 * Stejný extraktor jako processLeafletPdf / dávky. Bez Tesseractu, bez otočení Y.
 */
export function parseLeafletPageFromPdfText(
  words: OcrWord[],
  page_no: number | null,
  store_id = "lidl"
): PdfTextParseResult {
  const pageNo = page_no ?? 1;
  const pageText = words.map((w) => w.text).join(" ");
  const dates = parseLeafletHeaderDates(pageText);
  const candidates = extractLeafletCandidates(words, {
    pageNo,
    validFrom: dates.valid_from,
    validTo: dates.valid_to,
  }).map((c) => applyPromoEvidence(c, words));

  const offers = candidatesToLidlOffers(candidates, page_no, store_id, () => null);
  const staged = applyBillaStaging(offers, {
    store_id,
    page_no,
    pageText,
    dates,
    words,
    layoutBoxes: candidates.map((c) => c.source_bbox),
  });

  return {
    offers: staged,
    word_count: words.length,
    price_anchors: findPriceAnchors(words),
    model: "pdf-text + leaflet-layout extractor + billa-staging",
  };
}
