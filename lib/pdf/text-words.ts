import type { OcrWord } from "../ocr/types.ts";

export type PdfTextItem = {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
};

export function textItemsToOcrWords(items: readonly unknown[]): {
  words: OcrWord[];
  text: string;
} {
  const words: OcrWord[] = [];
  const parts: string[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as PdfTextItem;
    if (typeof item.str !== "string") continue;
    const text = item.str.trim();
    if (!text) continue;
    const t = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
    words.push({
      text,
      x: Number(t[4] ?? 0),
      y: Number(t[5] ?? 0),
      w: Math.max(1, Number(item.width ?? text.length * 5)),
      h: Math.max(1, Number(item.height ?? Math.abs(Number(t[3] ?? 10)))),
    });
    parts.push(text);
  }
  return { words, text: parts.join(" ") };
}

export function pdfTextLayerLooksUsable(words: OcrWord[]): boolean {
  if (words.length < 8) return false;
  const priceHits = words.filter((w) => /\d{1,3}[,.]\d{2}/.test(w.text)).length;
  return priceHits >= 1 || words.length >= 40;
}
