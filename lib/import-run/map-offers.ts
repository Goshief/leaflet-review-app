import type { OfferQuarantineInsert, OfferRawInsert } from "@/lib/import-run/import-run";

export type MapOffersMeta = {
  import_id: string;
  source_type: string;
  source_url: string | null;
  today_iso: string; // YYYY-MM-DD
};

export type RowStatus = "pending" | "approved" | "rejected" | "quarantine" | "quarantined";
export type RequiredProblem =
  | "missing_extracted_name"
  | "missing_price_total"
  | "bad_price_total"
  | "bad_currency"
  | "missing_valid_to";

function requiredReasonValue(problems: RequiredProblem[]) {
  return `db_required_missing:${problems.join(",")}`;
}

export function mapOffersForImportRun(args: {
  offers: any[];
  row_status: Record<number, RowStatus | undefined>;
  meta: MapOffersMeta;
}): {
  rawRows: OfferRawInsert[];
  quarantineRows: OfferQuarantineInsert[];
  counts: { raw: number; quarantine: number };
  requiredFieldErrors: Array<{
    index: number;
    problems: RequiredProblem[];
  }>;
} {
  const rawRows: OfferRawInsert[] = [];
  const quarantineRows: OfferQuarantineInsert[] = [];
  const requiredFieldErrors: Array<{
    index: number;
    problems: RequiredProblem[];
  }> = [];

  for (let i = 0; i < args.offers.length; i++) {
    const o = args.offers[i] ?? {};
    const s0 = args.row_status[i] ?? "pending";
    const s: RowStatus = s0 === "quarantined" ? "quarantine" : s0;

    const extracted_name = (o.extracted_name ?? "").toString().trim();
    const price_total = o.price_total ?? null;
    const currency = (o.currency ?? "CZK").toString();
    const valid_to = (o.valid_to ?? o.valid_from ?? args.meta.today_iso) as any;
    const valid_to_str = (valid_to ?? "").toString().trim();

    const reqProblems: RequiredProblem[] = [];
    if (!extracted_name) reqProblems.push("missing_extracted_name");
    if (price_total == null) reqProblems.push("missing_price_total");
    else if (!Number.isFinite(Number(price_total))) reqProblems.push("bad_price_total");
    if (currency !== "CZK") reqProblems.push("bad_currency");
    if (!valid_to_str) reqProblems.push("missing_valid_to");
    const missingRequired = reqProblems.length > 0;
    if (missingRequired) requiredFieldErrors.push({ index: i, problems: reqProblems });

    const toQuarantine = s === "quarantine" || s === "pending" || s === "rejected" || missingRequired;

    if (toQuarantine) {
      quarantineRows.push({
        import_id: args.meta.import_id,
        store_id: o.store_id ?? null,
        source_type: o.source_type ?? args.meta.source_type,
        source_url: args.meta.source_url,
        valid_from: o.valid_from ?? null,
        valid_to: (o.valid_to ?? valid_to_str) || args.meta.today_iso,
        extracted_name: extracted_name || null,
        price_total: price_total,
        currency: currency,
        pack_qty: o.pack_qty ?? null,
        pack_unit: o.pack_unit ?? null,
        pack_unit_qty: o.pack_unit_qty ?? null,
        price_standard: o.price_standard ?? null,
        typical_price_per_unit: o.typical_price_per_unit ?? null,
        price_with_loyalty_card: o.price_with_loyalty_card ?? null,
        has_loyalty_card_price: o.has_loyalty_card_price ?? null,
        notes: o.notes ?? null,
        brand: o.brand ?? null,
        category: o.category ?? null,
        quarantine_reason: missingRequired
          ? requiredReasonValue(reqProblems)
          : s === "rejected"
            ? "rejected_in_ui"
            : "quarantine_in_ui",
      });
      continue;
    }

    rawRows.push({
      import_id: args.meta.import_id,
      store_id: (o.store_id ?? "lidl").toString(),
      source_type: (o.source_type ?? args.meta.source_type ?? "leaflet").toString(),
      source_url: args.meta.source_url,
      valid_from: o.valid_from ?? null,
      valid_to: valid_to_str || args.meta.today_iso,
      extracted_name,
      price_total: Number(price_total),
      currency: "CZK",
      pack_qty: o.pack_qty ?? null,
      pack_unit: o.pack_unit ?? null,
      pack_unit_qty: o.pack_unit_qty ?? null,
      price_standard: o.price_standard ?? null,
      typical_price_per_unit: o.typical_price_per_unit ?? null,
      price_with_loyalty_card: o.price_with_loyalty_card ?? null,
      has_loyalty_card_price: o.has_loyalty_card_price ?? null,
      notes: o.notes ?? null,
      brand: o.brand ?? null,
      category: o.category ?? null,
    });
  }

  return {
    rawRows,
    quarantineRows,
    counts: { raw: rawRows.length, quarantine: quarantineRows.length },
    requiredFieldErrors,
  };
}

