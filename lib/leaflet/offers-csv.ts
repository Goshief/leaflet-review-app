import { LIDL_PAGE_OFFER_KEYS } from "../lidl-parser/lidl-page-offer.ts";

export function pickStagingFields(
  row: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of LIDL_PAGE_OFFER_KEYS) {
    out[key] = key in row ? row[key] : null;
  }
  return out;
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = typeof value === "boolean" || typeof value === "number" ? String(value) : String(value);
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function leafletOffersToCsv(rows: Array<Record<string, unknown>>) {
  const staged = rows.map(pickStagingFields);
  const lines = [
    LIDL_PAGE_OFFER_KEYS.join(";"),
    ...staged.map((row) => LIDL_PAGE_OFFER_KEYS.map((key) => csvCell(row[key])).join(";")),
  ];
  return `\uFEFF${lines.join("\n")}`;
}

export function leafletOffersToJson(rows: Array<Record<string, unknown>>) {
  return `${JSON.stringify(rows.map(pickStagingFields), null, 2)}\n`;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadLeafletOffersCsv(
  rows: Array<Record<string, unknown>>,
  fileName: string
) {
  triggerDownload(
    new Blob([leafletOffersToCsv(rows)], { type: "text/csv;charset=utf-8" }),
    fileName
  );
}

export function downloadLeafletOffersJson(
  rows: Array<Record<string, unknown>>,
  fileName: string
) {
  triggerDownload(
    new Blob([leafletOffersToJson(rows)], { type: "application/json;charset=utf-8" }),
    fileName
  );
}
