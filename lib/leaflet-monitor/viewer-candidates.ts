import { createHash } from "node:crypto";

export const VIEWER_EXTRACTOR_VERSION = "viewer-text-price-anchors-v2";

export type ViewerCandidate = {
  candidate_key: string;
  page_no: number;
  source_text: string;
  product_name: string | null;
  price_sale: number;
  status: "unreviewed" | "quarantine";
  confidence: number;
  review_reason: string;
  field_evidence: Record<string, unknown>;
  extraction_payload: Record<string, unknown>;
  extractor_version: string;
};

const PRICE_RE = /(?<!\d)(\d{1,3}(?:[,.]\d{2}|,-))(?!\d)/g;
const LETTER_RE = /[A-Za-zÁ-ž]/;
const SECONDARY_CONTEXT = /(?:1\s*kg|100\s*g|1\s*l|100\s*ml|běžná\s*cena|původní\s*cena|cena\s+za|KC:|A:)/i;
const NOISE = /(?:AKCE|pouze|sleva|-?\d+\s*%|do\s+vyprodání\s+zásob|s\s+klubem|bez\s+klubu)/gi;

function numberPrice(raw: string) {
  const normalized = raw.endsWith(",-" ) ? `${raw.slice(0, -2)}.00` : raw.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 && n < 10000 ? n : null;
}

function cleanName(value: string) {
  const text = value
    .replace(PRICE_RE, " ")
    .replace(NOISE, " ")
    .replace(/\([^)]{0,100}\)/g, " ")
    .replace(/[^0-9A-Za-zÁ-ž+&'\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text.split(" ").filter(Boolean);
  const tail = words.slice(-8).join(" ").trim();
  if (tail.length < 3 || !LETTER_RE.test(tail)) return null;
  return tail.slice(0, 120);
}

export function extractAllViewerCandidates(text: string, pageNo: number): ViewerCandidate[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  const matches = [...normalized.matchAll(PRICE_RE)];
  const out: ViewerCandidate[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const raw = match[1]!;
    const price = numberPrice(raw);
    if (price == null || match.index == null) continue;

    const at = match.index;
    const previousAt = i > 0 ? (matches[i - 1]!.index ?? 0) + matches[i - 1]![0].length : 0;
    const nextAt = i + 1 < matches.length ? (matches[i + 1]!.index ?? normalized.length) : normalized.length;
    const left = normalized.slice(Math.max(previousAt, at - 150), at).trim();
    const right = normalized.slice(at + match[0].length, Math.min(nextAt, at + match[0].length + 90)).trim();
    const context = `${left} ${raw} ${right}`.replace(/\s+/g, " ").trim();
    const productName = cleanName(left) ?? cleanName(right);
    const secondary = SECONDARY_CONTEXT.test(left.slice(-55));
    const status: "unreviewed" | "quarantine" = productName && !secondary ? "unreviewed" : "quarantine";
    const digest = createHash("sha1").update(`${pageNo}|${i}|${raw}|${context}`).digest("hex").slice(0, 16);

    out.push({
      candidate_key: `viewer-p${pageNo}-${i + 1}-${digest}`,
      page_no: pageNo,
      source_text: context,
      product_name: productName,
      price_sale: price,
      status,
      confidence: status === "unreviewed" ? 0.55 : 0.2,
      review_reason: status === "unreviewed"
        ? "Viewer kandidát vznikl z jednoho cenového anchoru a nejbližšího textového bloku. Vyžaduje ruční kontrolu."
        : "Cenový anchor byl zachycen, ale produkt nebo role ceny nejsou jednoznačné. Položka se nesmí tiše zahodit.",
      field_evidence: {
        price_sale: { raw_text: raw, source: "viewer_text" },
        product_name: productName ? { raw_text: productName, source: "viewer_text" } : null,
      },
      extraction_payload: {
        source: "viewer_text",
        anchor_index: i,
        context,
        secondary_context: secondary,
      },
      extractor_version: VIEWER_EXTRACTOR_VERSION,
    });
  }
  return out;
}
