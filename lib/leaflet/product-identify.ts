import type { LeafletProduct } from "./leaflet-product.ts";
import type { ProductBBox } from "./product-bbox.ts";

export type IdentifiableProduct = LeafletProduct & { bbox?: ProductBBox | null };

export function normalizeProductLabel(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function bboxIou(a: ProductBBox, b: ProductBBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  const inter = w * h;
  const union = a.width * a.height + b.width * b.height - inter;
  if (union <= 0) return 0;
  return inter / union;
}

export type ProductHint = {
  extracted_name?: string | null;
  brand?: string | null;
  index?: number;
  bbox?: ProductBBox | null;
};

export function identifyProductOnPage(
  discovered: IdentifiableProduct[],
  hint: ProductHint,
): { index: number; product: IdentifiableProduct } | null {
  if (!discovered.length) return null;

  if (hint.bbox) {
    let best = -1;
    let bestIou = 0.15;
    for (let i = 0; i < discovered.length; i++) {
      const box = discovered[i]?.bbox;
      if (!box) continue;
      const iou = bboxIou(hint.bbox, box);
      if (iou > bestIou) {
        bestIou = iou;
        best = i;
      }
    }
    if (best >= 0) return { index: best, product: discovered[best]! };
  }

  const wantName = normalizeProductLabel(hint.extracted_name);
  if (wantName) {
    const exact = discovered.findIndex((row) => normalizeProductLabel(row.extracted_name) === wantName);
    if (exact >= 0) return { index: exact, product: discovered[exact]! };
    const fuzzy = discovered.findIndex((row) => {
      const have = normalizeProductLabel(row.extracted_name);
      return Boolean(have) && (have.includes(wantName) || wantName.includes(have));
    });
    if (fuzzy >= 0) return { index: fuzzy, product: discovered[fuzzy]! };
  }

  const wantBrand = normalizeProductLabel(hint.brand);
  if (wantBrand) {
    const brandHit = discovered.findIndex((row) => normalizeProductLabel(row.brand) === wantBrand);
    if (brandHit >= 0) return { index: brandHit, product: discovered[brandHit]! };
  }

  if (typeof hint.index === "number" && discovered[hint.index]) {
    return { index: hint.index, product: discovered[hint.index]! };
  }

  return { index: 0, product: discovered[0]! };
}

export function matchExistingToDiscovered<T extends LeafletProduct & { bbox?: ProductBBox | null }>(
  existing: T[],
  discovered: IdentifiableProduct[],
): Array<{
  existing: T | null;
  discovered: IdentifiableProduct | null;
  existingIndex: number | null;
  discoveredIndex: number | null;
}> {
  const used = new Set<number>();
  const pairs: Array<{
    existing: T | null;
    discovered: IdentifiableProduct | null;
    existingIndex: number | null;
    discoveredIndex: number | null;
  }> = [];

  existing.forEach((row, existingIndex) => {
    let best = -1;
    let bestScore = 0;
    discovered.forEach((product, discoveredIndex) => {
      if (used.has(discoveredIndex)) return;
      const want = normalizeProductLabel(row.extracted_name);
      const have = normalizeProductLabel(product.extracted_name);
      const nameScore = want && have && (want === have || have.includes(want) || want.includes(have)) ? 2 : 0;
      const currentBox = rowBbox(row);
      const bboxScore = currentBox && product.bbox ? bboxIou(currentBox, product.bbox) : 0;
      const indexBonus = existingIndex === discoveredIndex ? 0.2 : 0;
      const score = nameScore + bboxScore + indexBonus;
      if (score > bestScore) {
        bestScore = score;
        best = discoveredIndex;
      }
    });
    if (best < 0 || bestScore < 0.35) {
      pairs.push({ existing: row, discovered: null, existingIndex, discoveredIndex: null });
      return;
    }
    used.add(best);
    pairs.push({ existing: row, discovered: discovered[best]!, existingIndex, discoveredIndex: best });
  });

  discovered.forEach((product, discoveredIndex) => {
    if (used.has(discoveredIndex)) return;
    pairs.push({ existing: null, discovered: product, existingIndex: null, discoveredIndex });
  });

  return pairs;
}

function rowBbox(
  row: LeafletProduct & { ai_checks?: { bbox?: ProductBBox | null } | null; bbox?: ProductBBox | null },
): ProductBBox | null {
  return row.bbox ?? row.ai_checks?.bbox ?? null;
}
