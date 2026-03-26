/**
 * Parsuje české ceny z OCR textu (čárka jako desetinný oddělovač, ,- jako celé Kč).
 */
export function parsePriceText(raw: string): number | null {
  // Normalizace OCR bordelu: mezery, NBSP, "Kč/Kc", atd.
  const s = raw
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(/(Kč|Kc)\.?$/i, "");
  let m = s.match(/^(\d{1,4})[.,](\d{2})$/);
  if (m) {
    const n = parseFloat(`${m[1]}.${m[2]}`);
    return Number.isFinite(n) ? n : null;
  }
  // OCR občas vrátí pomlčku místo desetinné tečky/čárky: "39-99"
  m = s.match(/^(\d{1,4})-(\d{2})$/);
  if (m) {
    const n = parseFloat(`${m[1]}.${m[2]}`);
    return Number.isFinite(n) ? n : null;
  }
  m = s.match(/^(\d{1,4})[,.-]?-$/);
  if (m) {
    const n = parseFloat(m[1]!);
    return Number.isFinite(n) ? n : null;
  }
  m = s.match(/^(\d{1,4})[.,](\d{1})$/);
  if (m) {
    const n = parseFloat(`${m[1]}.${m[2]}0`);
    return Number.isFinite(n) ? n : null;
  }
  // OCR často vrátí "12990" místo "129,90" (bez oddělovače).
  // Pro 3 číslice je to příliš nejednoznačné (500 může být 500 g), proto ber až 4–6 číslic.
  if (/^\d{4,6}$/.test(s)) {
    const major = s.slice(0, -2);
    const minor = s.slice(-2);
    const n = parseFloat(`${major}.${minor}`);
    if (Number.isFinite(n) && n >= 1 && n <= 9999.99) return n;
  }
  return null;
}
