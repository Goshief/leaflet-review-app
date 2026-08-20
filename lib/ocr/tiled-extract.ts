import sharp from "sharp";
import type { OcrWord } from "./types";
import { extractWordsFromImageBuffer } from "./tesseract-extract";

function normalizeText(text: string) {
  return text.trim().toLocaleLowerCase("cs-CZ").replace(/\s+/g, " ");
}

function dedupeWords(words: OcrWord[]): OcrWord[] {
  const kept: OcrWord[] = [];
  for (const word of words.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const key = normalizeText(word.text);
    if (!key) continue;
    const cx = word.x + word.w / 2;
    const cy = word.y + word.h / 2;
    const duplicate = kept.some((other) => {
      if (normalizeText(other.text) !== key) return false;
      const ocx = other.x + other.w / 2;
      const ocy = other.y + other.h / 2;
      return Math.abs(cx - ocx) <= Math.max(10, Math.min(word.w, other.w) * 0.25) &&
        Math.abs(cy - ocy) <= Math.max(8, Math.min(word.h, other.h) * 0.45);
    });
    if (!duplicate) kept.push(word);
  }
  return kept;
}

function numericText(text: string): string | null {
  if (/%/.test(text)) return null;
  const digits = text.replace(/[^0-9]/g, "");
  return digits || null;
}

/**
 * Lidl/Kaufland často tisknou celé koruny velkým písmem a haléře menším
 * samostatným blokem napravo. OCR proto vrací např. `189` + `90` místo
 * `189,90`. Podle geometrie vytvoříme navíc syntetický cenový token; původní
 * slova zachováváme kvůli auditu a ostatním polím.
 */
function addSplitPriceWords(words: OcrWord[]): OcrWord[] {
  const synthetic: OcrWord[] = [];
  for (const major of words) {
    const majorDigits = numericText(major.text);
    if (!majorDigits || majorDigits.length < 1 || majorDigits.length > 3) continue;
    if (major.h < 34) continue;

    const majorCy = major.y + major.h / 2;
    const candidates = words
      .filter((minor) => minor !== major)
      .map((minor) => ({ minor, digits: numericText(minor.text) }))
      .filter(({ minor, digits }) => {
        if (!digits || digits.length !== 2) return false;
        if (minor.x <= major.x + major.w * 0.72) return false;
        const gap = minor.x - (major.x + major.w);
        if (gap > Math.max(70, major.h * 0.85)) return false;
        if (gap < -Math.max(18, major.w * 0.12)) return false;
        const minorCy = minor.y + minor.h / 2;
        if (Math.abs(minorCy - majorCy) > Math.max(34, major.h * 0.35)) return false;
        if (minor.h < major.h * 0.28 || minor.h > major.h * 1.05) return false;
        return true;
      })
      .sort((a, b) => Math.abs(a.minor.x - (major.x + major.w)) - Math.abs(b.minor.x - (major.x + major.w)));

    const match = candidates[0];
    if (!match) continue;
    const value = Number(`${majorDigits}.${match.digits}`);
    if (!Number.isFinite(value) || value < 1 || value > 999.99) continue;
    const x0 = Math.min(major.x, match.minor.x);
    const y0 = Math.min(major.y, match.minor.y);
    const x1 = Math.max(major.x + major.w, match.minor.x + match.minor.w);
    const y1 = Math.max(major.y + major.h, match.minor.y + match.minor.h);
    synthetic.push({ text: `${majorDigits},${match.digits}`, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return dedupeWords([...words, ...synthetic]);
}

/**
 * OCR pro husté reklamní letáky. Celá stránka je pro Tesseract příliš
 * komplikovaná; menší překrývající se dlaždice výrazně omezí grafický šum.
 * Výsledné bboxy jsou převedeny zpět do souřadnic originální stránky.
 */
export async function extractWordsFromLeafletImageBuffer(
  buf: Buffer,
  options?: { columns?: number; rows?: number; overlap?: number; scale?: number }
): Promise<OcrWord[]> {
  const metadata = await sharp(buf).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) return extractWordsFromImageBuffer(buf);

  const columns = Math.max(1, Math.min(5, options?.columns ?? 3));
  const rows = Math.max(1, Math.min(8, options?.rows ?? 4));
  const overlap = Math.max(0, Math.min(120, options?.overlap ?? 48));
  const scale = Math.max(1, Math.min(2.5, options?.scale ?? 1.6));
  const cellW = Math.ceil(width / columns);
  const cellH = Math.ceil(height / rows);
  const out: OcrWord[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const baseLeft = column * cellW;
      const baseTop = row * cellH;
      const left = Math.max(0, baseLeft - (column > 0 ? overlap : 0));
      const top = Math.max(0, baseTop - (row > 0 ? overlap : 0));
      const right = Math.min(width, baseLeft + cellW + (column + 1 < columns ? overlap : 0));
      const bottom = Math.min(height, baseTop + cellH + (row + 1 < rows ? overlap : 0));
      const tileW = Math.max(1, right - left);
      const tileH = Math.max(1, bottom - top);

      const tile = await sharp(buf)
        .extract({ left, top, width: tileW, height: tileH })
        .resize({ width: Math.round(tileW * scale), withoutEnlargement: false })
        .grayscale()
        .normalize()
        .sharpen()
        .png()
        .toBuffer();

      const words = await extractWordsFromImageBuffer(tile);
      for (const word of words) {
        out.push({
          text: word.text,
          x: left + word.x / scale,
          y: top + word.y / scale,
          w: word.w / scale,
          h: word.h / scale,
        });
      }
    }
  }

  return addSplitPriceWords(dedupeWords(out));
}
