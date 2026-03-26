import type { BBox, OcrWord, PriceAnchor } from "./types";
import { DEFAULT_PRICE_WINDOW } from "./types";
import { parsePriceText } from "./price-parse";

function wordBBox(w: OcrWord): BBox {
  return { x0: w.x, y0: w.y, x1: w.x + w.w, y1: w.y + w.h };
}

function unionBBox(boxes: BBox[]): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  return { x0, y0, x1, y1 };
}

function center(b: BBox): { cx: number; cy: number } {
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
}

/** Seskupí slova do řádků podle podobné základní y (baseline). */
export function clusterIntoLines(words: OcrWord[], yTolerance = 14): OcrWord[][] {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: OcrWord[][] = [];
  for (const w of sorted) {
    const my = w.y + w.h / 2;
    let placed = false;
    for (const line of lines) {
      const ref = line[0]!;
      const ry = ref.y + ref.h / 2;
      if (Math.abs(my - ry) <= yTolerance) {
        line.push(w);
        placed = true;
        break;
      }
    }
    if (!placed) lines.push([w]);
  }
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
  }
  return lines;
}

function dedupeAnchors(anchors: PriceAnchor[]): PriceAnchor[] {
  const out: PriceAnchor[] = [];
  for (const a of anchors) {
    const c = center(a.bbox);
    const dup = out.some((b) => {
      const d = center(b.bbox);
      const dist = Math.hypot(c.cx - d.cx, c.cy - d.cy);
      return dist < 8 && Math.abs(a.priceKc - b.priceKc) < 0.01;
    });
    if (!dup) out.push(a);
  }
  return out;
}

function isUnitToken(t: string): boolean {
  return /^(?:g|kg|ml|l|ks|kus|rol[ií])$/i.test(t.trim());
}

function hasUnitNearby(line: OcrWord[], i: number): boolean {
  const here = line[i]!;
  const hx0 = here.x;
  const hx1 = here.x + here.w;
  // Projdi malé okolí na řádku (max 3 tokeny) a hledej jednotku těsně vedle (typicky "500 g -")
  for (const j of [i - 2, i - 1, i + 1, i + 2, i + 3]) {
    const w = line[j];
    if (!w) continue;
    const t = w.text.trim();
    if (!isUnitToken(t)) continue;
    const x0 = w.x;
    const x1 = w.x + w.w;
    const gap = x0 >= hx1 ? x0 - hx1 : hx0 - x1;
    if (Math.abs(gap) <= 28) return true;
  }
  return false;
}

function isLikelyYear(t: string): boolean {
  const s = t.trim();
  if (!/^\d{4}$/.test(s)) return false;
  const n = Number(s);
  return n >= 2000 && n <= 2099;
}

/**
 * Najde kotvy cen: jednotlivá slova a krátké spojení slov na jednom řádku.
 */
export function findPriceAnchors(words: OcrWord[]): PriceAnchor[] {
  const lines = clusterIntoLines(words);
  const anchors: PriceAnchor[] = [];

  for (const line of lines) {
    for (let wi = 0; wi < line.length; wi++) {
      const w = line[wi]!;
      const t = w.text.trim();
      // Filtry na falešné kotvy: rok, gramáž (často "500 g"), jednotkovky ("kg=79,80")
      if (isLikelyYear(t)) continue;
      if (hasUnitNearby(line, wi)) continue;
      const p = parsePriceText(t);
      if (p != null) {
        anchors.push({
          priceKc: p,
          rawText: t,
          bbox: wordBBox(w),
        });
      }
    }

    for (let i = 0; i < line.length - 1; i++) {
      const merged =
        line[i]!.text.trim() +
        line[i + 1]!.text.trim().replace(/^\s+/, "");
      if (isLikelyYear(merged)) continue;
      const p = parsePriceText(merged);
      if (p != null) {
        anchors.push({
          priceKc: p,
          rawText: merged,
          bbox: unionBBox([wordBBox(line[i]!), wordBBox(line[i + 1]!)]),
        });
      }
    }

    if (line.length >= 3) {
      for (let i = 0; i < line.length - 2; i++) {
        const merged = [line[i], line[i + 1], line[i + 2]]
          .map((x) => x!.text.trim())
          .join("");
        if (isLikelyYear(merged)) continue;
        // Pokud je v textu "kg=" nebo "1kg=" je to jednotková cena, ne hlavní kotva.
        if (/\b\d+\s*kg\s*=\s*/i.test(merged)) continue;
        const p = parsePriceText(merged);
        if (p != null) {
          anchors.push({
            priceKc: p,
            rawText: merged,
            bbox: unionBBox([
              wordBBox(line[i]!),
              wordBBox(line[i + 1]!),
              wordBBox(line[i + 2]!),
            ]),
          });
        }
      }
    }
  }

  return dedupeAnchors(anchors);
}

function wordCenter(w: OcrWord): { x: number; y: number } {
  return { x: w.x + w.w / 2, y: w.y + w.h / 2 };
}

function inPriceWindow(
  w: OcrWord,
  anchor: PriceAnchor,
  win: typeof DEFAULT_PRICE_WINDOW
): boolean {
  const { cx, cy } = center(anchor.bbox);
  const p = wordCenter(w);
  return (
    p.x >= cx - win.padLeft &&
    p.x <= cx + win.padRight &&
    p.y >= cy - win.padUp &&
    p.y <= cy + win.padDown
  );
}

/**
 * Každé slovo přiřadí nejbližší kotvě (mezi kotvami, jejichž okno slovo obsahuje).
 */
export function assignWordsToAnchors(
  words: OcrWord[],
  anchors: PriceAnchor[],
  win = DEFAULT_PRICE_WINDOW
): Map<number, OcrWord[]> {
  const map = new Map<number, OcrWord[]>();
  anchors.forEach((_, i) => map.set(i, []));

  for (const w of words) {
    const candidates: { i: number; d: number }[] = [];
    let idx = 0;
    for (const a of anchors) {
      if (inPriceWindow(w, a, win)) {
        const { cx, cy } = center(a.bbox);
        const p = wordCenter(w);
        const d = Math.hypot(p.x - cx, p.y - cy);
        candidates.push({ i: idx, d });
      }
      idx++;
    }
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => a.d - b.d);
    const best = candidates[0]!.i;
    map.get(best)!.push(w);
  }

  return map;
}

export function unionWordsBBox(words: OcrWord[], pad = 6): BBox | null {
  if (words.length === 0) return null;
  const boxes = words.map(wordBBox);
  const u = unionBBox(boxes);
  return {
    x0: u.x0 - pad,
    y0: u.y0 - pad,
    x1: u.x1 + pad,
    y1: u.y1 + pad,
  };
}
