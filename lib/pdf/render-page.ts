import { textItemsToOcrWords } from "./text-words";
import type { OcrWord } from "../ocr/types";

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
  pageNumber1Based: number,
  options?: { scale?: number; type?: "image/png" | "image/jpeg"; quality?: number }
): Promise<Blob> {
  const pdfjs = await getPdfjs();
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const n = pdf.numPages;
  if (pageNumber1Based < 1 || pageNumber1Based > n) {
    throw new Error(`Stránka ${pageNumber1Based} není v rozsahu 1–${n}.`);
  }
  const page = await pdf.getPage(pageNumber1Based);
  const scale = options?.scale ?? 1.45;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Nelze vytvořit 2D kontext canvasu.");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  const type = options?.type ?? "image/jpeg";
  const quality = options?.quality ?? 0.82;
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob selhal"))),
      type,
      type === "image/jpeg" ? quality : undefined
    );
  });
}

export async function renderPdfPageToPngFile(
  file: File,
  pageNumber1Based: number,
  options?: { scale?: number; type?: "image/png" | "image/jpeg"; quality?: number }
): Promise<File> {
  const type = options?.type ?? "image/jpeg";
  const blob = await renderPdfPageToPngBlob(file, pageNumber1Based, { ...options, type });
  const ext = type === "image/png" ? "png" : "jpg";
  const base = file.name.replace(/\.pdf$/i, "") || "letak";
  return new File([blob], `${base}-p${pageNumber1Based}.${ext}`, { type });
}

export async function loadPdfDocument(file: File) {
  const pdfjs = await getPdfjs();
  const data = await file.arrayBuffer();
  return pdfjs.getDocument({ data }).promise;
}

export async function extractPdfPageWords(
  file: File,
  pageNumber1Based: number
): Promise<{ words: OcrWord[]; text: string; numPages: number }> {
  const pdf = await loadPdfDocument(file);
  const n = pdf.numPages;
  if (pageNumber1Based < 1 || pageNumber1Based > n) {
    throw new Error(`Stránka ${pageNumber1Based} není v rozsahu 1–${n}.`);
  }
  const page = await pdf.getPage(pageNumber1Based);
  const content = await page.getTextContent();
  const { words, text } = textItemsToOcrWords(content.items);
  return { words, text, numPages: n };
}

export async function renderLoadedPdfPage(
  pdf: Awaited<ReturnType<typeof loadPdfDocument>>,
  pageNumber1Based: number,
  scale: number
): Promise<Blob> {
  if (pageNumber1Based < 1 || pageNumber1Based > pdf.numPages) {
    throw new Error(`Stránka ${pageNumber1Based} není v rozsahu 1–${pdf.numPages}.`);
  }
  const page = await pdf.getPage(pageNumber1Based);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Nelze vytvořit 2D kontext canvasu.");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob selhal"))), "image/jpeg", 0.82);
  });
}
