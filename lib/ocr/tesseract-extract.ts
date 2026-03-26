import type { OcrWord } from "./types";

/**
 * Tesseract OCR nad PNG/JPEG bufferem — vrací slova s bbox (pixely).
 * Volat z Node (API route), ne z prohlížeče.
 */
export async function extractWordsFromImageBuffer(
  buf: Buffer
): Promise<OcrWord[]> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("ces+eng");
  try {
    const {
      data: { words },
    } = await worker.recognize(buf);
    const list = (words ?? []) as Array<{
      text: string;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>;
    return list
      .map((w) => ({
        text: w.text,
        x: w.bbox.x0,
        y: w.bbox.y0,
        w: Math.max(0, w.bbox.x1 - w.bbox.x0),
        h: Math.max(0, w.bbox.y1 - w.bbox.y0),
      }))
      .filter((w) => w.text.trim().length > 0);
  } finally {
    await worker.terminate();
  }
}
