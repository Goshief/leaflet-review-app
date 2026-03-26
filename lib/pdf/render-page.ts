/**
 * Klient-side vykreslení jedné stránky PDF do PNG (pro OpenAI vision).
 * Spouštěj jen v prohlížeči (canvas).
 */

const WORKER_SRC =
  "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

async function getPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
  return pdfjs;
}

export async function getPdfPageCount(file: File): Promise<number> {
  const pdfjs = await getPdfjs();
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  return pdf.numPages;
}

/**
 * @param pageNumber1Based 1 … numPages
 */
export async function renderPdfPageToPngBlob(
  file: File,
  pageNumber1Based: number
): Promise<Blob> {
  const pdfjs = await getPdfjs();
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const n = pdf.numPages;
  if (pageNumber1Based < 1 || pageNumber1Based > n) {
    throw new Error(`Stránka ${pageNumber1Based} není v rozsahu 1–${n}.`);
  }
  const page = await pdf.getPage(pageNumber1Based);
  // Vyšší scale = lepší OCR na cenách (za cenu většího PNG).
  const scale = 3;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Nelze vytvořit 2D kontext canvasu.");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob selhal"))),
      "image/png"
    );
  });
}

export async function renderPdfPageToPngFile(
  file: File,
  pageNumber1Based: number
): Promise<File> {
  const blob = await renderPdfPageToPngBlob(file, pageNumber1Based);
  const base =
    file.name.replace(/\.pdf$/i, "") || "letak";
  return new File([blob], `${base}-p${pageNumber1Based}.png`, {
    type: "image/png",
  });
}
