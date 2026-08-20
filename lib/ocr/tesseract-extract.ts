import type { OcrWord } from "./types";

type TesseractWorker = {
  recognize(image: Buffer): Promise<{
    data: {
      words?: Array<{
        text: string;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
    };
  }>;
  setParameters(parameters: Record<string, string>): Promise<unknown>;
  terminate(): Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;
let ocrTail: Promise<void> = Promise.resolve();

async function getSharedWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = import("tesseract.js")
      .then(async ({ createWorker }) => {
        const worker = (await createWorker("ces+eng")) as TesseractWorker;
        await worker.setParameters({
          // PSM 11 = sparse text. Letáky mají mnoho samostatných textových
          // ostrůvků a cen, takže automatická "jedna stránka textu" segmentace
          // zbytečně spojuje grafické prvky a ztrácí ceny.
          tessedit_pageseg_mode: "11",
          preserve_interword_spaces: "1",
        });
        return worker;
      })
      .catch((error) => {
        workerPromise = null;
        throw error;
      });
  }
  return workerPromise;
}

async function resetSharedWorker() {
  const current = workerPromise;
  workerPromise = null;
  if (!current) return;
  try {
    const worker = await current;
    await worker.terminate();
  } catch {
    // The worker is already unusable; a later call will create a fresh one.
  }
}

function toWords(words: Awaited<ReturnType<TesseractWorker["recognize"]>>["data"]["words"]): OcrWord[] {
  return (words ?? [])
    .map((word) => ({
      text: word.text,
      x: word.bbox.x0,
      y: word.bbox.y0,
      w: Math.max(0, word.bbox.x1 - word.bbox.x0),
      h: Math.max(0, word.bbox.y1 - word.bbox.y0),
    }))
    .filter((word) => word.text.trim().length > 0);
}

/**
 * Tesseract OCR nad PNG/JPEG bufferem — vrací slova s bbox (pixely).
 *
 * Worker je znovu použit v rámci teplé Node/Vercel instance. Inicializace
 * `ces+eng` je drahá, takže ji nesmíme opakovat pro každou stránku letáku.
 * Volání jsou serializována, protože jeden Tesseract worker nesmí současně
 * zpracovávat více obrázků.
 */
export async function extractWordsFromImageBuffer(buf: Buffer): Promise<OcrWord[]> {
  const run = async () => {
    try {
      const worker = await getSharedWorker();
      const { data } = await worker.recognize(buf);
      return toWords(data.words);
    } catch (error) {
      await resetSharedWorker();
      throw error;
    }
  };

  const result = ocrTail.then(run, run);
  ocrTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
