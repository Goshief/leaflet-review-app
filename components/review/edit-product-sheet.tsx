"use client";

import type { ReviewOfferRow } from "@/components/review/offers-table";
import { useEffect, useState } from "react";

/* eslint-disable react-hooks/set-state-in-effect */

export function EditProductSheet({
  open,
  offer,
  onClose,
  onSave,
}: {
  open: boolean;
  offer: ReviewOfferRow | null;
  onClose: () => void;
  onSave: (patch: Partial<ReviewOfferRow>) => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [standard, setStandard] = useState("");
  const [loyalty, setLoyalty] = useState("");
  const [hasLoyalty, setHasLoyalty] = useState(false);
  const [packQty, setPackQty] = useState("");
  const [packUnit, setPackUnit] = useState("");
  const [packSize, setPackSize] = useState("");
  const [packUnknown, setPackUnknown] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!offer) return;
    setName(offer.extracted_name ?? "");
    setPrice(offer.price_total != null ? String(offer.price_total) : "");
    setStandard(offer.price_standard != null ? String(offer.price_standard) : "");
    setLoyalty(
      offer.price_with_loyalty_card != null
        ? String(offer.price_with_loyalty_card)
        : ""
    );
    setHasLoyalty(offer.has_loyalty_card_price === true);
    setPackQty(offer.pack_qty != null ? String(offer.pack_qty) : "");
    setPackUnit(offer.pack_unit ?? "");
    setPackSize(offer.pack_unit_qty != null ? String(offer.pack_unit_qty) : "");
    setPackUnknown((offer.pack_unit ?? "").toString().trim().toLowerCase() === "unknown");
    setNotes(offer.notes ?? "");
  }, [offer]);

  if (!open) return null;

  const field =
    "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20";

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        aria-label="Zavřít"
        onClick={onClose}
      />
      <div
        className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl ring-1 ring-slate-200"
        role="dialog"
        aria-modal
      >
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Upravit produkt</h2>
          <p className="mt-1 text-sm text-slate-500">
            Změny platí jen v této relaci (zápis do DB přijde později).
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Název produktu
              </label>
              <input
                className={field}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Cena
                </label>
                <input className={field} value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Běžná cena
                </label>
                <input
                  className={field}
                  value={standard}
                  onChange={(e) => setStandard(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Lidl Plus cena
              </label>
              <input
                className={field}
                value={loyalty}
                onChange={(e) => setLoyalty(e.target.value)}
                disabled={!hasLoyalty}
              />
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-slate-600">Má Lidl Plus cenu?</span>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={hasLoyalty}
                  onChange={() => setHasLoyalty(true)}
                  className="text-indigo-600"
                />
                Ano
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={!hasLoyalty}
                  onChange={() => setHasLoyalty(false)}
                  className="text-indigo-600"
                />
                Ne
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Qty
                </label>
                <input className={field} value={packQty} onChange={(e) => setPackQty(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Jednotka
                </label>
                <input
                  className={field}
                  value={packUnit}
                  onChange={(e) => {
                    setPackUnit(e.target.value);
                    setPackUnknown(e.target.value.trim().toLowerCase() === "unknown");
                  }}
                  disabled={packUnknown}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Velikost
                </label>
                <input
                  className={field}
                  value={packSize}
                  onChange={(e) => setPackSize(e.target.value)}
                  disabled={packUnknown}
                />
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={packUnknown}
                onChange={(e) => {
                  const on = e.target.checked;
                  setPackUnknown(on);
                  if (on) {
                    setPackQty("");
                    setPackSize("");
                    setPackUnit("unknown");
                  } else {
                    if (packUnit.trim().toLowerCase() === "unknown") setPackUnit("");
                  }
                }}
                className="rounded border-slate-300 text-indigo-600"
              />
              Balení neznámé (explicitně <code className="text-slate-800">unknown</code>)
            </label>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Poznámka
              </label>
              <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 px-6 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Zrušit
            </button>
            <button
              type="button"
              onClick={() => {
                if (!offer) return;
                const pt = parseFloat(price.replace(",", "."));
                const ps = standard.trim() ? parseFloat(standard.replace(",", ".")) : NaN;
                const pl = loyalty.trim() ? parseFloat(loyalty.replace(",", ".")) : NaN;
                const pq = packQty.trim() ? parseFloat(packQty.replace(",", ".")) : NaN;
                const psz = packSize.trim() ? parseFloat(packSize.replace(",", ".")) : NaN;
                onSave({
                  extracted_name: name.trim() || null,
                  price_total: Number.isFinite(pt) ? pt : null,
                  price_standard: Number.isFinite(ps) ? ps : null,
                  price_with_loyalty_card:
                    hasLoyalty && Number.isFinite(pl) ? pl : null,
                  has_loyalty_card_price: hasLoyalty,
                  pack_qty: packUnknown ? null : Number.isFinite(pq) ? pq : null,
                  pack_unit: packUnknown ? "unknown" : packUnit.trim() || null,
                  pack_unit_qty: packUnknown ? null : Number.isFinite(psz) ? psz : null,
                  notes: notes.trim() || null,
                });
                onClose();
              }}
              className="rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 hover:bg-indigo-700"
            >
              Uložit změny
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
