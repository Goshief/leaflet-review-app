"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BatchItemTable } from "@/lib/batches/item-update";
import {
  canBatchItemRunSaveAction,
  resolveBatchItemImageState,
} from "@/lib/product-types/resolve-batch-item-image-state";

export type BatchCommittedItem = {
  id: string;
  import_id: string;
  source_table: BatchItemTable;
  extracted_name: string | null;
  price_total: number | null;
  currency: string | null;
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
  valid_from: string | null;
  valid_to: string | null;
  created_at: string | null;
  suggested_image_key?: string | null;
  approved_image_key?: string | null;
};

type Props = {
  items: BatchCommittedItem[];
};

type FormState = {
  extracted_name: string;
  price_total: string;
  currency: string;
  pack_qty: string;
  pack_unit: string;
  pack_unit_qty: string;
  price_standard: string;
  typical_price_per_unit: string;
  price_with_loyalty_card: string;
  has_loyalty_card_price: boolean;
  notes: string;
  brand: string;
  category: string;
  valid_from: string;
  valid_to: string;
};

function toInput(value: string | number | null | undefined) {
  if (value == null) return "";
  return String(value);
}

function toDateInput(value: string | null | undefined) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function toNumberOrNull(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function makeForm(item: BatchCommittedItem): FormState {
  return {
    extracted_name: toInput(item.extracted_name),
    price_total: toInput(item.price_total),
    currency: toInput(item.currency),
    pack_qty: toInput(item.pack_qty),
    pack_unit: toInput(item.pack_unit),
    pack_unit_qty: toInput(item.pack_unit_qty),
    price_standard: toInput(item.price_standard),
    typical_price_per_unit: toInput(item.typical_price_per_unit),
    price_with_loyalty_card: toInput(item.price_with_loyalty_card),
    has_loyalty_card_price: item.has_loyalty_card_price === true,
    notes: toInput(item.notes),
    brand: toInput(item.brand),
    category: toInput(item.category),
    valid_from: toDateInput(item.valid_from),
    valid_to: toDateInput(item.valid_to),
  };
}

function prettyDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("cs-CZ");
  } catch {
    return iso;
  }
}

function cell(value: string | number | boolean | null | undefined) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "ano" : "ne";
  return String(value);
}

export function BatchItemsEditor({ items }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<BatchCommittedItem | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const bySource = useMemo(() => {
    const raw = items.filter((i) => i.source_table === "offers_raw");
    const quarantine = items.filter((i) => i.source_table === "offers_quarantine");
    return { raw, quarantine };
  }, [items]);

  const openEditor = (item: BatchCommittedItem) => {
    setEditing(item);
    setForm(makeForm(item));
    setError(null);
    setSuccess(null);
  };

  const closeEditor = () => {
    setEditing(null);
    setForm(null);
    setSaving(false);
  };

  const field =
    "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20";

  const onSave = async () => {
    if (!editing || !form) return;
    setError(null);
    setSuccess(null);
    if (!canBatchItemRunSaveAction(editing)) {
      setError("Produkt nemá obrázek v galerii. Nejdřív přidej nebo vygeneruj obrázek.");
      return;
    }

    const priceTotal = toNumberOrNull(form.price_total);
    const packQty = toNumberOrNull(form.pack_qty);
    const packUnitQty = toNumberOrNull(form.pack_unit_qty);
    const priceStandard = toNumberOrNull(form.price_standard);
    const ppu = toNumberOrNull(form.typical_price_per_unit);
    const loyalty = toNumberOrNull(form.price_with_loyalty_card);

    const nums = [
      ["price_total", priceTotal],
      ["pack_qty", packQty],
      ["pack_unit_qty", packUnitQty],
      ["price_standard", priceStandard],
      ["typical_price_per_unit", ppu],
      ["price_with_loyalty_card", loyalty],
    ] as const;
    for (const [name, value] of nums) {
      if (Number.isNaN(value)) {
        setError(`Pole ${name} musí být číslo.`);
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/batches/item", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          import_id: editing.import_id,
          source_table: editing.source_table,
          patch: {
            extracted_name: form.extracted_name.trim() || null,
            price_total: priceTotal,
            currency: form.currency.trim() || null,
            pack_qty: packQty,
            pack_unit: form.pack_unit.trim() || null,
            pack_unit_qty: packUnitQty,
            price_standard: priceStandard,
            typical_price_per_unit: ppu,
            price_with_loyalty_card: loyalty,
            has_loyalty_card_price: form.has_loyalty_card_price,
            notes: form.notes.trim() || null,
            brand: form.brand.trim() || null,
            category: form.category.trim() || null,
            valid_from: form.valid_from || null,
            valid_to: form.valid_to || null,
          },
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Uložení selhalo");
      }
      setSuccess("Položka byla úspěšně upravena.");
      closeEditor();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Uložení selhalo");
    } finally {
      setSaving(false);
    }
  };

  const renderRows = (rows: BatchCommittedItem[]) =>
    rows.map((item) => {
      const imageState = resolveBatchItemImageState(item);
      return (
      <tr key={`${item.source_table}:${item.id}`} className="border-b border-slate-100">
        <td className="px-3 py-2 font-mono text-xs text-slate-600">{cell(item.id)}</td>
        <td className="px-3 py-2 font-mono text-xs text-slate-600">{cell(item.import_id)}</td>
        <td className="px-3 py-2 text-xs text-slate-500">{cell(item.source_table)}</td>
        <td className="px-3 py-2 text-slate-700">
          {imageState.hasValidImage ? (
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
              {imageState.resolvedImageKey}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-xl border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
              {imageState.imageStatusMessage}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-slate-900">{cell(item.extracted_name)}</td>
        <td className="px-3 py-2 text-slate-700">{cell(item.brand)}</td>
        <td className="px-3 py-2 text-slate-700">{cell(item.category)}</td>
        <td className="px-3 py-2 text-slate-800">
          {item.price_total != null
            ? `${item.price_total} ${item.currency ?? ""}`.trim()
            : "—"}
        </td>
        <td className="px-3 py-2 text-slate-700">{cell(item.currency)}</td>
        <td className="px-3 py-2 text-slate-700">{cell(item.price_with_loyalty_card)}</td>
        <td className="px-3 py-2 text-slate-700">{cell(item.pack_qty)}</td>
        <td className="px-3 py-2 text-slate-700">{cell(item.pack_unit)}</td>
        <td className="px-3 py-2 text-slate-700">{cell(item.pack_unit_qty)}</td>
        <td className="px-3 py-2 text-slate-700">{cell(item.price_standard)}</td>
        <td className="px-3 py-2 text-slate-700">{cell(item.typical_price_per_unit)}</td>
        <td className="px-3 py-2 text-slate-700">{cell(item.valid_from)}</td>
        <td className="px-3 py-2 text-slate-700">{cell(item.valid_to)}</td>
        <td className="max-w-[220px] px-3 py-2 text-slate-700">{cell(item.notes)}</td>
        <td className="px-3 py-2 text-slate-600">{prettyDateTime(item.created_at)}</td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={() => openEditor(item)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Upravit položku
          </button>
        </td>
      </tr>
      );
    });

  const editingImageState = editing ? resolveBatchItemImageState(editing) : null;
  const saveBlockedByImage = editing ? !canBatchItemRunSaveAction(editing) : false;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Seznam portovaných produktů</h2>
          <p className="mt-1 text-sm text-slate-600">
            Všechny položky uložené v Supabase pro tuto dávku ({items.length} celkem).
          </p>
        </div>
      </div>

      {success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Pro tento import zatím nejsou uložené žádné položky.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[1680px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Row ID</th>
                <th className="px-3 py-2">Import ID</th>
                <th className="px-3 py-2">Source table</th>
                <th className="px-3 py-2">Stav obrázku</th>
                <th className="px-3 py-2">Název</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Kategorie</th>
                <th className="px-3 py-2">Cena</th>
                <th className="px-3 py-2">Měna</th>
                <th className="px-3 py-2">Loyalty cena</th>
                <th className="px-3 py-2">Pack qty</th>
                <th className="px-3 py-2">Pack unit</th>
                <th className="px-3 py-2">Pack unit qty</th>
                <th className="px-3 py-2">Price standard</th>
                <th className="px-3 py-2">Typical/unit</th>
                <th className="px-3 py-2">Valid from</th>
                <th className="px-3 py-2">Valid to</th>
                <th className="px-3 py-2">Poznámky</th>
                <th className="px-3 py-2">Vytvořeno</th>
                <th className="px-3 py-2 text-right">Akce</th>
              </tr>
            </thead>
            <tbody>
              {renderRows(bySource.raw)}
              {renderRows(bySource.quarantine)}
            </tbody>
          </table>
        </div>
      )}

      {editing && form ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label="Zavřít"
            onClick={closeEditor}
          />
          <div className="relative z-10 w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">
              Upravit položku ({editing.source_table})
            </h3>
            <p className="mt-1 text-xs text-slate-500">ID: {editing.id}</p>
            {editingImageState?.imageMissing ? (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {editingImageState.imageStatusMessage}
              </p>
            ) : (
              <p className="mt-3 text-xs text-emerald-700">image_key: {editingImageState?.resolvedImageKey}</p>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-700">
                Název
                <input className={field} value={form.extracted_name} onChange={(e) => setForm({ ...form, extracted_name: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                Cena celkem
                <input className={field} value={form.price_total} onChange={(e) => setForm({ ...form, price_total: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                Měna
                <input className={field} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                Pack qty
                <input className={field} value={form.pack_qty} onChange={(e) => setForm({ ...form, pack_qty: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                Pack unit
                <input className={field} value={form.pack_unit} onChange={(e) => setForm({ ...form, pack_unit: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                Pack unit qty
                <input className={field} value={form.pack_unit_qty} onChange={(e) => setForm({ ...form, pack_unit_qty: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                Price standard
                <input className={field} value={form.price_standard} onChange={(e) => setForm({ ...form, price_standard: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                Typical price per unit
                <input className={field} value={form.typical_price_per_unit} onChange={(e) => setForm({ ...form, typical_price_per_unit: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                Price with loyalty card
                <input className={field} value={form.price_with_loyalty_card} onChange={(e) => setForm({ ...form, price_with_loyalty_card: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                Brand
                <input className={field} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                Category
                <input className={field} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                Valid from
                <input type="date" className={field} value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                Valid to
                <input type="date" className={field} value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 pt-6 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.has_loyalty_card_price}
                  onChange={(e) => setForm({ ...form, has_loyalty_card_price: e.target.checked })}
                />
                has_loyalty_card_price
              </label>
              <label className="sm:col-span-2 text-sm text-slate-700">
                Poznámky
                <textarea className={field} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Zrušit
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saving || saveBlockedByImage}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Ukládám..." : saveBlockedByImage ? "Uložit změny (vyžaduje validní obrázek)" : "Uložit změny"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
