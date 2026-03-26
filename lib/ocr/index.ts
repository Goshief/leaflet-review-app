export { extractWordsFromImageBuffer } from "./tesseract-extract";
export { runOcrPipeline } from "./pipeline";
export type { OcrPipelineResult } from "./pipeline";
export type { OcrWord, BBox, PriceAnchor } from "./types";
export { findPriceAnchors, assignWordsToAnchors, unionWordsBBox } from "./price-anchors";
export { parsePriceText } from "./price-parse";
export type { LidlOfferWithOcrCrop } from "./to-lidl-offer";
