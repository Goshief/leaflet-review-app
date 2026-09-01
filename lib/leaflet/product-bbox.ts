import { createCanvas, loadImage } from "@napi-rs/canvas";

export type ProductBBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function finite(n: unknown): number | null {
  const value = Number(n);
  return Number.isFinite(value) ? value : null;
}

/**
 * Normalize bbox to 0–1 of the page (top-left). Accepts 0–1, 0–1000, or pixel coords.
 */
export function normalizeProductBBox(raw: unknown, imageWidth = 0, imageHeight = 0): ProductBBox | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const x = finite(obj.x);
  const y = finite(obj.y);
  const width = finite(obj.width) ?? finite(obj.w);
  const height = finite(obj.height) ?? finite(obj.h);
  if (x == null || y == null || width == null || height == null) return null;
  if (width <= 0 || height <= 0 || x < 0 || y < 0) return null;

  const x2 = x + width;
  const y2 = y + height;
  let nx = x;
  let ny = y;
  let nw = width;
  let nh = height;
  if (x2 <= 1.05 && y2 <= 1.05) {
    // already 0–1
  } else if (x2 <= 1000.5 && y2 <= 1000.5) {
    nx = x / 1000;
    ny = y / 1000;
    nw = width / 1000;
    nh = height / 1000;
  } else if (imageWidth > 0 && imageHeight > 0) {
    nx = x / imageWidth;
    ny = y / imageHeight;
    nw = width / imageWidth;
    nh = height / imageHeight;
  } else {
    return null;
  }

  nw = Math.min(nw, 1 - nx);
  nh = Math.min(nh, 1 - ny);
  if (nw <= 0.002 || nh <= 0.002) return null;
  return { x: nx, y: ny, width: nw, height: nh };
}

export function enlargeProductBBox(bbox: ProductBBox, padRatio = 0.2): ProductBBox {
  const x = Math.max(0, bbox.x - bbox.width * padRatio);
  const y = Math.max(0, bbox.y - bbox.height * padRatio);
  const x2 = Math.min(1, bbox.x + bbox.width * (1 + padRatio));
  const y2 = Math.min(1, bbox.y + bbox.height * (1 + padRatio));
  return { x, y, width: x2 - x, height: y2 - y };
}

export async function cropEnlargedProductPng(
  pagePng: Uint8Array,
  bbox: ProductBBox | null,
  options?: { padRatio?: number; scale?: number },
): Promise<Uint8Array> {
  const image = await loadImage(Buffer.from(pagePng));
  const area = enlargeProductBBox(bbox ?? { x: 0, y: 0, width: 1, height: 1 }, options?.padRatio ?? 0.2);
  const sx = Math.max(0, Math.floor(area.x * image.width));
  const sy = Math.max(0, Math.floor(area.y * image.height));
  const sw = Math.max(1, Math.min(image.width - sx, Math.ceil(area.width * image.width)));
  const sh = Math.max(1, Math.min(image.height - sy, Math.ceil(area.height * image.height)));
  const scale = options?.scale ?? 2;
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const canvas = createCanvas(dw, dh);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, dw, dh);
  return new Uint8Array(canvas.toBuffer("image/png"));
}
