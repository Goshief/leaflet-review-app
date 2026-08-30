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
