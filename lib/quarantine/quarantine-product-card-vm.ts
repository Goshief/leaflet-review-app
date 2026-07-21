import type { QuarantineListItem } from "@/lib/quarantine/list-quarantine";

export type QuarantineProductCardVm = {
  name: string;
  brand: string | null;
  category: string | null;
  price: string;
  standardPrice: string | null;
  loyaltyPrice: string | null;
  packageText: string | null;
  validity: string | null;
  notes: string | null;
  reason: string;
  hasOcrThumb: boolean;
};

function money(value: number | null, currency: string | null): string | null {
  if (value == null) return null;
  return `${value.toLocaleString("cs-CZ")} ${currency || "CZK"}`;
}

function prettyReason(raw: string | null): string {
  const reason = (raw ?? "").trim();
  if (!reason) return "—";
  if (reason === "rejected_in_ui") return "zamítnuto v kontrole";
  if (reason === "quarantine_in_ui") return "ručně přesunuto do karantény";
  if (reason === "db_required_missing") return "chybí povinná pole";
  if (reason.startsWith("db_required_missing:")) {
    return `chybí povinná pole: ${reason.slice("db_required_missing:".length)}`;
  }
  return reason;
}

export function quarantineListItemToFullCardVm(
  item: QuarantineListItem
): QuarantineProductCardVm {
  const packageParts = [item.pack_qty, item.pack_unit_qty, item.pack_unit]
    .filter((value) => value != null && value !== "")
    .map(String);
  const validParts = [item.valid_from, item.valid_to].filter(Boolean);

  return {
    name: item.extracted_name || "—",
    brand: item.brand,
    category: item.category,
    price: money(item.price_total, item.currency) || "Cena neuvedena",
    standardPrice: money(item.price_standard, item.currency),
    loyaltyPrice: money(item.price_with_loyalty_card, item.currency),
    packageText: packageParts.length ? packageParts.join(" ") : null,
    validity: validParts.length ? validParts.join(" – ") : null,
    notes: item.notes,
    reason: prettyReason(item.quarantine_reason),
    hasOcrThumb: Boolean(item.source_url),
  };
}
