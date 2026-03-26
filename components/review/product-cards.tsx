"use client";

import type { ReviewOfferRow } from "@/components/review/offers-table";
import { useMemo, useState } from "react";

export type RowReviewStatus = "pending" | "approved" | "rejected" | "quarantine";

export type RowReason =
  | {
      kind: "quarantine";
      code:
        | "missing_price"
        | "missing_packaging"
        | "unclear_name"
        | "suspicious_ocr"
        | "duplicate"
        | "other";
      detail?: string | null;
    }
  | {
      kind: "rejected";
      code:
        | "not_a_product"
        | "bad_block"
        | "duplicate_row"
        | "nonsense_price"
        | "other";
      detail?: string | null;
    };

function reasonLabel(r: RowReason) {
  const d = (r.detail ?? "").toString().trim();
  const base =
    r.kind === "quarantine"
      ? r.code === "missing_price"
        ? "chybí cena"
        : r.code === "missing_packaging"
          ? "chybí balení"
          : r.code === "unclear_name"
            ? "nejasný název"
            : r.code === "suspicious_ocr"
              ? "podezřelá OCR extrakce"
              : r.code === "duplicate"
                ? "duplicita"
                : "jiný důvod"
      : r.code === "not_a_product"
        ? "není to produkt"
        : r.code === "bad_block"
          ? "špatně rozpoznaný blok"
          : r.code === "duplicate_row"
            ? "duplicitní řádek"
            : r.code === "nonsense_price"
              ? "nesmyslná cena"
              : "jiný důvod";
  return d ? `${base} — ${d}` : base;
}

export function computeRowCounts(
  indices: number[],
  rowStatus: Record<number, RowReviewStatus | undefined>
) {
  let approved = 0;
  let rejected = 0;
  let quarantined = 0;
  let pending = 0;
  for (const i of indices) {
    const s = rowStatus[i] ?? "pending";
    if (s === "approved") approved++;
    else if (s === "rejected") rejected++;
    else if (s === "quarantine") quarantined++;
    else pending++;
  }
  return { approved, rejected, quarantined, pending };
}

export function ProductReviewCards(props: {
  offers: ReviewOfferRow[];
  pageImageSrc?: string | null;
  onEdit: (index: number) => void;
  disabled?: boolean;
  rowStatus: Record<number, RowReviewStatus | undefined>;
  rowReason?: Record<number, RowReason | undefined>;
  onRowStatus: (index: number, status: RowReviewStatus) => void;
  onRequestRowStatus?: (indices: number[], status: RowReviewStatus) => void;
  onBulkSetCategory?: (indices: number[], category: string | null) => void;
  onApproveAll: (indices: number[]) => void;
  filterStatus?: RowReviewStatus | "all";
  excludeStatuses?: RowReviewStatus[];
  visibleIndices?: number[];
}) {
  const {
    offers,
    disabled,
    rowStatus,
    rowReason,
    onRowStatus,
    onRequestRowStatus,
    onBulkSetCategory,
    onEdit,
    onApproveAll,
    visibleIndices,
  } = props;

  const base = useMemo(
    () =>
      // `visibleIndices` je source-of-truth pro render. Pokud je to prázdné pole,
      // chceme opravdu zobrazit 0 položek (a ne fallback na všechny).
      (visibleIndices != null ? visibleIndices : offers.map((_, i) => i)).filter((i) => i >= 0 && i < offers.length),
    [offers, visibleIndices]
  );

  const [selected, setSelected] = useState<Record<number, true>>({});
  const selectedIndices = useMemo(
    () =>
      Object.keys(selected)
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n)),
    [selected]
  );
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");

  const bulk = (s: RowReviewStatus) => {
    if (!selectedIndices.length) return;
    if (onRequestRowStatus) return onRequestRowStatus(selectedIndices, s);
    for (const i of selectedIndices) onRowStatus(i, s);
  };

  const anySelectedNotPending = useMemo(() => {
    if (!selectedIndices.length) return false;
    for (const i of selectedIndices) {
      const s = rowStatus[i] ?? "pending";
      if (s !== "pending") return true;
    }
    return false;
  }, [rowStatus, selectedIndices]);

  if (!base.length)
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-[0_4px_24px_rgba(15,23,42,0.04)]">
        <p className="text-slate-900 font-semibold">
          Žádná položka neodpovídá aktuálním filtrům.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Zkus změnit tab, zrušit focus na detail, nebo použít „Reset filtrů“.
        </p>
      </div>
    );

  return (
    <div className="space-y-3">
      {selectedIndices.length ? (
        <div className="sticky top-2 z-10 rounded-2xl border border-slate-200 bg-white/90 p-2 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">
              Vybráno: {selectedIndices.length}
            </span>
            <button
              disabled={disabled}
              onClick={() => bulk("approved")}
              className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Schválit
            </button>
            <button
              disabled={disabled}
              onClick={() => bulk("rejected")}
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 disabled:opacity-50"
            >
              Zamítnout
            </button>
            <button
              disabled={disabled}
              onClick={() => bulk("quarantine")}
              className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 disabled:opacity-50"
            >
              Karanténa
            </button>
            <button
              disabled={disabled}
              onClick={() => (onRequestRowStatus ? onRequestRowStatus(selectedIndices, "quarantine") : bulk("quarantine"))}
              className="rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-800 disabled:opacity-50"
              title="Nastaví stejný důvod karantény pro vybrané (a dá je do karantény)"
            >
              Nastavit důvod karantény
            </button>
            {onBulkSetCategory ? (
              <button
                disabled={disabled}
                onClick={() => setBulkCategoryOpen((v) => !v)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                title="Nastaví stejnou kategorii pro vybrané položky"
              >
                Nastavit kategorii
              </button>
            ) : null}
            {anySelectedNotPending ? (
              <button
                disabled={disabled}
                onClick={() => bulk("pending")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                Vrátit
              </button>
            ) : null}
            <button
              disabled={disabled}
              onClick={() => setSelected({})}
              className="ml-auto text-xs font-semibold text-slate-600 hover:underline disabled:opacity-50"
            >
              Zrušit
            </button>
          </div>
          {onBulkSetCategory && bulkCategoryOpen ? (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={bulkCategory}
                onChange={(e) => setBulkCategory(e.target.value)}
                placeholder="např. maso, mléčné, ovoce… (prázdné = smazat)"
                className="w-full flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
              />
              <button
                disabled={disabled}
                onClick={() => {
                  const v = bulkCategory.trim();
                  onBulkSetCategory(selectedIndices, v ? v : null);
                  setBulkCategoryOpen(false);
                  setBulkCategory("");
                }}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Použít na vybrané
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Produkty na stránce</h2>
        <button
          disabled={disabled}
          onClick={() => onApproveAll(base)}
          className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Schválit vše v zobrazení
        </button>
      </div>

      <ul className="space-y-2">
        {base.map((i) => {
          const o = offers[i]!;
          const s = rowStatus[i] ?? "pending";
          const r = rowReason?.[i];
          return (
            <li key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={!!selected[i]}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = { ...prev };
                      if (e.target.checked) next[i] = true;
                      else delete next[i];
                      return next;
                    })
                  }
                  className="mt-0.5 h-8 w-8 cursor-pointer rounded-lg border-2 border-slate-300 text-indigo-600 shadow-sm outline-none ring-0 transition focus-visible:border-indigo-400 focus-visible:ring-4 focus-visible:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-9"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{o.extracted_name ?? "—"}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                      {s}
                    </span>
                    {typeof o.page_no === "number" ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                        str. {o.page_no}
                      </span>
                    ) : null}
                  </div>
                  {r && (s === "quarantine" || s === "rejected") ? (
                    <p className="mt-1 text-xs text-slate-700">
                      <strong>Důvod:</strong> {reasonLabel(r)}
                    </p>
                  ) : null}
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold text-slate-900 tabular-nums">
                    {o.price_total != null ? `${o.price_total} Kč` : "—"}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  disabled={disabled}
                  onClick={() => onEdit(i)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                >
                  Upravit
                </button>
                <button
                  disabled={disabled}
                  onClick={() => onRowStatus(i, "approved")}
                  className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Schválit
                </button>
                {s !== "pending" ? (
                  <button
                    disabled={disabled}
                    onClick={() => onRowStatus(i, "pending")}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Vrátit
                  </button>
                ) : null}
                <button
                  disabled={disabled}
                  onClick={() =>
                    onRequestRowStatus ? onRequestRowStatus([i], "quarantine") : onRowStatus(i, "quarantine")
                  }
                  className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 disabled:opacity-50"
                >
                  Karanténa
                </button>
                <button
                  disabled={disabled}
                  onClick={() =>
                    onRequestRowStatus ? onRequestRowStatus([i], "rejected") : onRowStatus(i, "rejected")
                  }
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 disabled:opacity-50"
                >
                  Zamítnout
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

