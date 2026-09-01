import { createCanvas } from "@napi-rs/canvas";

export type RenderedPdfPage = {
  page_no: number;
  width: number;
  height: number;
  png: Uint8Array;
};

type CanvasAndContext = {
  canvas: ReturnType<typeof createCanvas>;
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>;
};

class NapiCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(pair: CanvasAndContext, width: number, height: number) {
    pair.canvas.width = Math.max(1, Math.ceil(width));
    pair.canvas.height = Math.max(1, Math.ceil(height));
  }
  destroy(pair: CanvasAndContext) {
    pair.canvas.width = 0;
    pair.canvas.height = 0;
  }
}

async function loadPdfDocument(bytes: Uint8Array) {
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = {
    WorkerMessageHandler: worker.WorkerMessageHandler,
  };
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    canvasFactory: new NapiCanvasFactory() as never,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;
}

/**
 * Server-side: PDF → one PNG per page. Does not extract products.
 */
export async function renderPdfPagesToPng(
  bytes: Uint8Array,
  options?: { scale?: number },
): Promise<RenderedPdfPage[]> {
  const scale = options?.scale ?? 1.35;
  const doc = await loadPdfDocument(bytes);
  try {
    const pages: RenderedPdfPage[] = [];
    for (let page_no = 1; page_no <= doc.numPages; page_no++) {
      const page = await doc.getPage(page_no);
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      await page.render({ canvasContext: context as never, viewport }).promise;
      pages.push({
        page_no,
        width,
        height,
        png: new Uint8Array(canvas.toBuffer("image/png")),
      });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const doc = await loadPdfDocument(bytes);
  try {
    return doc.numPages;
  } finally {
    await doc.destroy();
  }
}
