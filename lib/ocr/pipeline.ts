import type { OcrWord } from "./types";
import {
  assignWordsToAnchors,
  findPriceAnchors,
  unionWordsBBox,
} from "./price-anchors";
import { classifyBlock } from "./block-heuristic";
import { heuristicToLidlOffers, type LidlOfferWithOcrCrop } from "./to-lidl-offer";

export type OcrPipelineResult = {
  /** Všechna slova z OCR (vrstva A). */
  ocr_words: OcrWord[];
  /** Kotvy cen. */
  price_anchors: ReturnType<typeof findPriceAnchors>;
  /** Řádky do stagingu + výřezy. */
  offers: LidlOfferWithOcrCrop[];
};

/**
 * OCR slova → kotvy cen → okna → heuristika → řádky Lidl (bez DB, bez AI).
 */
export function runOcrPipeline(words: OcrWord[], page_no: number | null): OcrPipelineResult {
  const price_anchors = findPriceAnchors(words);
  const byAnchor = assignWordsToAnchors(words, price_anchors);

  const offers: LidlOfferWithOcrCrop[] = [];
  let i = 0;
  for (const anchor of price_anchors) {
    const blockWords = byAnchor.get(i) ?? [];
    i++;
    const merged = [...blockWords];
    if (merged.length === 0) {
      continue;
    }
    const h = classifyBlock(merged, anchor);
    const crop = unionWordsBBox(merged);
    offers.push(
      ...heuristicToLidlOffers([{ heuristic: h, crop }], page_no)
    );
  }

  return { ocr_words: words, price_anchors, offers };
}
