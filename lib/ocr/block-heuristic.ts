import type { OcrWord } from "./types";
import type { PriceAnchor } from "./types";
import { parsePriceText } from "./price-parse";

const BADGE_RES = [
  /\bAKCE\b/i,
  /\bNOVINKA\b/i,
  /\bSUPER\s*CENA\b/i,
  /\bVÝHODNĚ\b/i,
  /\bJEN\s*TENTO\s*TÝDEN\b/i,
  /-\s*\d{1,3}\s*%/,
  /\bLIDL\s*PLUS\b/i,
];

const UNIT_RE =
  /\b\d[\d\s.,]*\s*(?:x\s*)?\d*\s*(?:g|kg|ml|m[lL]|ks|ks\.|kus|rolí|pack)\b/i;

export type HeuristicProduct = {
  name: string | null;
  priceKc: number;
  priceRaw: string;
  unit: string | null;
  badge: string | null;
  blockText: string;
};

export function classifyBlock(
  words: OcrWord[],
  anchor: PriceAnchor
): HeuristicProduct {
  const texts = words
    .map((w) => w.text.trim())
    .filter((t) => t.length > 0);

  const badgeParts: string[] = [];
  const unitParts: string[] = [];
  const rest: string[] = [];

  for (const t of texts) {
    if (BADGE_RES.some((r) => r.test(t))) {
      badgeParts.push(t);
      continue;
    }
    if (UNIT_RE.test(t) && parsePriceText(t) === null) {
      unitParts.push(t);
      continue;
    }
    if (parsePriceText(t) !== null) {
      continue;
    }
    rest.push(t);
  }

  const name =
    rest.sort((a, b) => b.length - a.length)[0] ?? null;

  return {
    name,
    priceKc: anchor.priceKc,
    priceRaw: anchor.rawText,
    unit: unitParts.join(" ") || null,
    badge: badgeParts.join(" · ") || null,
    blockText: texts.join(" "),
  };
}
