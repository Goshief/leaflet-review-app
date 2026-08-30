const HEADERS = [
  "page_no",
  "extracted_name",
  "brand",
  "price_total",
  "price_standard",
  "price_with_loyalty_card",
  "pack_qty",
  "pack_unit",
  "category",
  "notes",
  "raw_text_block",
] as const;

export function leafletOffersToCsv(rows: Array<Record<string, unknown>>) {
  const lines = [
    HEADERS.join(";"),
    ...rows.map((row) =>
      HEADERS.map((key) => {
        const value = row[key];
        if (value == null) return "";
        const text = String(value);
        return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      }).join(";")
    ),
  ];
  return `\uFEFF${lines.join("\n")}`;
}

export function downloadLeafletOffersCsv(
  rows: Array<Record<string, unknown>>,
  fileName: string
) {
  const blob = new Blob([leafletOffersToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
