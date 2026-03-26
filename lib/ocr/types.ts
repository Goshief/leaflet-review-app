/** Jedno slovo/symbol z OCR (souřadnice v pixelech obrázku). */
export type OcrWord = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BBox = { x0: number; y0: number; x1: number; y1: number };

/** Kotva = nalezená cena + její oblast. */
export type PriceAnchor = {
  priceKc: number;
  rawText: string;
  bbox: BBox;
};

export const DEFAULT_PRICE_WINDOW = {
  padLeft: 250,
  padRight: 250,
  padUp: 220,
  padDown: 120,
} as const;
