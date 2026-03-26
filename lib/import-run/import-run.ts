import type { PoolClient } from "pg";

export type ImportRunCreate = {
  source_type: string;
  source_url: string | null;
  note: string | null;
};

export type ImportRun = { id: string; batch_no: number | null };

export type OfferRawInsert = {
  import_id: string;
  store_id: string;
  source_type: string;
  source_url: string | null;
  valid_from: string | null;
  valid_to: string;
  extracted_name: string;
  price_total: number;
  currency: "CZK";
  pack_qty: number | null;
  pack_unit: string | null;
  pack_unit_qty: number | null;
  price_standard: number | null;
  typical_price_per_unit: number | null;
  price_with_loyalty_card: number | null;
  has_loyalty_card_price: boolean | null;
  notes: string | null;
  brand: string | null;
  category: string | null;
};

export type OfferQuarantineInsert = Omit<OfferRawInsert, "store_id" | "valid_to" | "extracted_name" | "price_total" | "currency"> & {
  import_id: string;
  store_id: string | null;
  valid_to: string;
  extracted_name: string | null;
  price_total: number | null;
  currency: string;
  quarantine_reason: string;
};

export async function createImportRun(client: PoolClient, req: ImportRunCreate): Promise<ImportRun> {
  const { rows } = await client.query<{ id: string; batch_no: number | null }>(
    `
INSERT INTO public.imports (source_type, source_url, note)
VALUES ($1, $2, $3)
RETURNING id, batch_no;
`.trim(),
    [req.source_type, req.source_url, req.note]
  );
  const r = rows[0];
  if (!r?.id) throw new Error("Nepodařilo se vytvořit import run (imports).");
  return { id: r.id, batch_no: r.batch_no ?? null };
}

function buildMultiValues<T extends Record<string, any>>(
  rows: T[],
  cols: (keyof T)[]
): { sql: string; params: any[] } {
  const params: any[] = [];
  const valuesSql: string[] = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri]!;
    const ph: string[] = [];
    for (let ci = 0; ci < cols.length; ci++) {
      params.push(r[cols[ci] as string]);
      ph.push(`$${params.length}`);
    }
    valuesSql.push(`(${ph.join(", ")})`);
  }
  return { sql: valuesSql.join(",\n"), params };
}

export async function bulkInsertOffersRaw(client: PoolClient, rows: OfferRawInsert[]) {
  if (!rows.length) return 0;
  const cols: (keyof OfferRawInsert)[] = [
    "import_id",
    "store_id",
    "source_type",
    "source_url",
    "valid_from",
    "valid_to",
    "extracted_name",
    "price_total",
    "currency",
    "pack_qty",
    "pack_unit",
    "pack_unit_qty",
    "price_standard",
    "typical_price_per_unit",
    "price_with_loyalty_card",
    "has_loyalty_card_price",
    "notes",
    "brand",
    "category",
  ];
  const { sql, params } = buildMultiValues(rows, cols);
  await client.query(
    `
INSERT INTO public.offers_raw (${cols.join(", ")})
VALUES
${sql};
`.trim(),
    params
  );
  return rows.length;
}

export async function bulkInsertOffersQuarantine(client: PoolClient, rows: OfferQuarantineInsert[]) {
  if (!rows.length) return 0;
  const cols: (keyof OfferQuarantineInsert)[] = [
    "import_id",
    "store_id",
    "source_type",
    "source_url",
    "valid_from",
    "valid_to",
    "extracted_name",
    "price_total",
    "currency",
    "pack_qty",
    "pack_unit",
    "pack_unit_qty",
    "price_standard",
    "typical_price_per_unit",
    "price_with_loyalty_card",
    "has_loyalty_card_price",
    "notes",
    "brand",
    "category",
    "quarantine_reason",
  ];
  const { sql, params } = buildMultiValues(rows, cols);
  await client.query(
    `
INSERT INTO public.offers_quarantine (${cols.join(", ")})
VALUES
${sql};
`.trim(),
    params
  );
  return rows.length;
}

