"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { getAvailableImageKeys } from "@/lib/product-types/image-keys";
import { buildImageReviewPatch } from "@/lib/product-types/image-review-actions";
import { getMissingAssetWorkflowState } from "@/lib/product-types/missing-asset-workflow";
import {
  canBatchItemRunSaveAction,
  resolveBatchItemImageState,
} from "@/lib/product-types/resolve-batch-item-image-state";

export type BatchCommittedItem = {
  id: string;
  import_id: string;
  source_table: "offers_raw" | "offers_quarantine";
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
  image_review_status?: "suggested" | "approved" | "rejected" | "manual_override" | null;
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

function cell(value: string | number | boolean | null | undefined) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "ano" : "ne";
  return String(value);
}

function prettyDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("cs-CZ");
  } catch {
    return iso;
  }
}

export function BatchItemsTableEditor({ items }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<BatchCommittedItem[]>(items);
  const [editing, setEditing] = useState<BatchCommittedItem | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewSavingKey, setReviewSavingKey] = useState<string | null>(null);
  const [manualOverrideByRow, setManualOverrideByRow] = useState<Record<string, string>>({});
  const [generationRequestedByRow, setGenerationRequestedByRow] = useState<Record<string, boolean>>({});
  const imageKeys = useMemo(() => getAvailableImageKeys(), []);

  const bySource = useMemo(() => {
    const raw = rows.filter((i) => i.source_table === "offers_raw");
    const quarantine = rows.filter((i) => i.source_table === "offers_quarantine");
    return { raw, quarantine };
  }, [rows]);

  const field =
    "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20";

  const openEditor = (item: BatchCommittedItem) => {
    setEditing(item);
    setForm(makeForm(item));
    setError(null);
    setSuccess(null);
  };

  const closeEditor = () => {
    setEditing(null);
    setForm(null);
    setError(null);
    setSaving(false);
  };

  const onSaveChanges = async () => {
    if (!editing || !form) return;
    setError(null);
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
      const payload = {
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
      };
      const res = await fetch("/api/batches/item", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        item?: BatchCommittedItem;
      };
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || json?.message || "Uložení změn selhalo.");
      }

      if (json.item) {
        setRows((prev) =>
          prev.map((row) =>
            row.id === json.item!.id &&
            row.import_id === json.item!.import_id &&
            row.source_table === json.item!.source_table
              ? json.item!
              : row
          )
        );
      }
      closeEditor();
      setSuccess("Položka byla úspěšně uložena.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Uložení změn selhalo.");
    } finally {
      setSaving(false);
    }
  };

  const rowKeyOf = (item: BatchCommittedItem) => `${item.source_table}:${item.id}:${item.import_id}`;

  const onImageReviewAction = async (
    item: BatchCommittedItem,
    action: "approve" | "reject" | "manual_override"
  ) => {
    const rowKey = rowKeyOf(item);
    const manualKey = manualOverrideByRow[rowKey] ?? "";
    const patchResult = buildImageReviewPatch(action, item, manualKey);
    if (!patchResult.ok) {
      setError(patchResult.error);
      return;
    }

    setError(null);
    setSuccess(null);
    setReviewSavingKey(rowKey);
    try {
      const res = await fetch("/api/batches/item", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          import_id: item.import_id,
          source_table: item.source_table,
          patch: patchResult.patch,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        item?: BatchCommittedItem;
      };
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || json?.message || "Uložení image review selhalo.");
      }
      if (json.item) {
        setRows((prev) =>
          prev.map((row) =>
            row.id === json.item!.id &&
            row.import_id === json.item!.import_id &&
            row.source_table === json.item!.source_table
              ? json.item!
              : row
          )
        );
      }
      setSuccess(
        action === "approve"
          ? "Obrázek byl schválen."
          : action === "reject"
            ? "Obrázek byl zamítnut."
            : "Byl uložen ruční override obrázku."
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Uložení image review selhalo.");
    } finally {
      setReviewSavingKey(null);
    }
  };

  const onRequestImageGeneration = (item: BatchCommittedItem) => {
    const rowKey = rowKeyOf(item);
    void (async () => {
      setError(null);
      setSuccess(null);
      setReviewSavingKey(rowKey);
      try {
        const imageState = resolveBatchItemImageState(item);
        const res = await fetch("/api/product-types/generation-request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            batchItemId: item.id,
            importId: item.import_id,
            sourceTable: item.source_table,
            productName: item.extracted_name,
            candidateImageKey: imageState.resolvedImageKey,
            source: "leaflet-review-app",
          }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          message?: string;
          created?: boolean;
        };
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || "Požadavek na generování se nepodařilo uložit.");
        }
        setGenerationRequestedByRow((prev) => ({ ...prev, [rowKey]: true }));
        setSuccess(json.message || "Požadavek na generování byl uložen.");
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Požadavek na generování se nepodařilo uložit."
        );
      } finally {
        setReviewSavingKey(null);
      }
    })();
  };

  const renderRows = (sourceRows: BatchCommittedItem[]) =>
    sourceRows.map((item) => {
      const imageState = resolveBatchItemImageState(item);
      const rowKey = rowKeyOf(item);
      const missingAssetState = getMissingAssetWorkflowState(
        imageState,
        generationRequestedByRow[rowKey] === true
      );
      return (
      <article
        key={`${item.source_table}:${item.id}`}
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{cell(item.extracted_name)}</p>
            <p className="mt-1 text-xs text-slate-600">
              ID: <span className="font-mono">{cell(item.id)}</span> · import_id:{" "}
              <span className="font-mono">{cell(item.import_id)}</span> · source_table:{" "}
              <span className="font-medium">{cell(item.source_table)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => openEditor(item)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Upravit položku
          </button>
        </div>

        <dl className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs text-slate-500">Stav obrázku</dt>
            <dd className="mt-1">
              {imageState.hasValidImage ? (
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                  image_key: {imageState.resolvedImageKey}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
                  {imageState.imageStatusMessage}
                </span>
              )}
            </dd>
          </div>
          {missingAssetState.showMissingAssetCta ? (
            <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
              <p className="text-sm font-semibold text-amber-900">{missingAssetState.title}</p>
              <p className="mt-1 text-xs text-amber-900/90">{missingAssetState.message}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRequestImageGeneration(item)}
                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-800"
                >
                  Generuj obrázek
                </button>
                <a
                  href="/product-types/gallery.html"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Přidat do galerie
                </a>
                {missingAssetState.showGenerationRequested ? (
                  <span className="text-xs text-indigo-700">Požadavek na generování zaznamenán.</span>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs text-slate-500">Image review akce</dt>
            <dd className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onImageReviewAction(item, "approve")}
                disabled={reviewSavingKey === rowKeyOf(item) || !imageState.hasValidImage}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => void onImageReviewAction(item, "reject")}
                disabled={reviewSavingKey === rowKeyOf(item)}
                className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reject
              </button>
              <select
                value={manualOverrideByRow[rowKeyOf(item)] ?? imageState.resolvedImageKey ?? ""}
                onChange={(e) =>
                  setManualOverrideByRow((prev) => ({
                    ...prev,
                    [rowKeyOf(item)]: e.target.value,
                  }))
                }
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
              >
                <option value="">Vyber image key</option>
                {imageKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void onImageReviewAction(item, "manual_override")}
                disabled={reviewSavingKey === rowKeyOf(item)}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Manual override
              </button>
              <span className="text-xs text-slate-500">
                status: {item.image_review_status ?? "—"}
              </span>
            </dd>
          </div>
          <div><dt className="text-xs text-slate-500">Brand</dt><dd>{cell(item.brand)}</dd></div>
          <div><dt className="text-xs text-slate-500">Kategorie</dt><dd>{cell(item.category)}</dd></div>
          <div>
            <dt className="text-xs text-slate-500">Cena</dt>
            <dd>{item.price_total != null ? `${item.price_total} ${item.currency ?? ""}`.trim() : "—"}</dd>
          </div>
          <div><dt className="text-xs text-slate-500">Měna</dt><dd>{cell(item.currency)}</dd></div>
          <div><dt className="text-xs text-slate-500">Loyalty cena</dt><dd>{cell(item.price_with_loyalty_card)}</dd></div>
          <div><dt className="text-xs text-slate-500">Pack qty</dt><dd>{cell(item.pack_qty)}</dd></div>
          <div><dt className="text-xs text-slate-500">Pack unit</dt><dd>{cell(item.pack_unit)}</dd></div>
          <div><dt className="text-xs text-slate-500">Pack unit qty</dt><dd>{cell(item.pack_unit_qty)}</dd></div>
          <div><dt className="text-xs text-slate-500">Price standard</dt><dd>{cell(item.price_standard)}</dd></div>
          <div><dt className="text-xs text-slate-500">Typical/unit</dt><dd>{cell(item.typical_price_per_unit)}</dd></div>
          <div><dt className="text-xs text-slate-500">Valid from</dt><dd>{cell(item.valid_from)}</dd></div>
          <div><dt className="text-xs text-slate-500">Valid to</dt><dd>{cell(item.valid_to)}</dd></div>
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs text-slate-500">Poznámky</dt>
            <dd>{cell(item.notes)}</dd>
          </div>
          <div><dt className="text-xs text-slate-500">Vytvořeno</dt><dd>{prettyDateTime(item.created_at)}</dd></div>
        </dl>
      </article>
      );
    });

  const editingImageState = editing ? resolveBatchItemImageState(editing) : null;
  const saveBlockedByImage = editing ? !canBatchItemRunSaveAction(editing) : false;
  const editingRowKey = editing ? rowKeyOf(editing) : null;
  const editingMissingAssetState = editingImageState
    ? getMissingAssetWorkflowState(
        editingImageState,
        editingRowKey ? generationRequestedByRow[editingRowKey] === true : false
      )
    : null;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Seznam portovaných produktů</h2>
        <p className="mt-1 text-sm text-slate-600">
          Všechny položky uložené v Supabase pro tuto dávku ({rows.length} celkem).
        </p>
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

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Pro tento import zatím nejsou uložené žádné položky.</p>
      ) : <div className="space-y-3">{renderRows(bySource.raw)}{renderRows(bySource.quarantine)}</div>}

      {editing && form ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label="Zavřít"
            onClick={closeEditor}
          />
          <div className="relative z-10 w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Upravit položku</h3>
            <p className="mt-1 text-xs text-slate-500">
              ID: {editing.id} · import_id: {editing.import_id} · source_table: {editing.source_table}
            </p>
            {editingImageState?.imageMissing ? (
              <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
                <p className="text-sm font-semibold text-amber-900">{editingMissingAssetState?.title}</p>
                <p className="mt-1 text-sm text-amber-900">{editingMissingAssetState?.message}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onRequestImageGeneration(editing)}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-800"
                  >
                    Generuj obrázek
                  </button>
                  <a
                    href="/product-types/gallery.html"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Přidat do galerie
                  </a>
                  {editingMissingAssetState?.showGenerationRequested ? (
                    <span className="text-xs text-indigo-700">Požadavek na generování zaznamenán.</span>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-emerald-700">
                image_key: {editingImageState?.resolvedImageKey}
              </p>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-700">
                extracted_name
                <input className={field} value={form.extracted_name} onChange={(e) => setForm({ ...form, extracted_name: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                price_total
                <input className={field} value={form.price_total} onChange={(e) => setForm({ ...form, price_total: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                currency
                <input className={field} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                pack_qty
                <input className={field} value={form.pack_qty} onChange={(e) => setForm({ ...form, pack_qty: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                pack_unit
                <input className={field} value={form.pack_unit} onChange={(e) => setForm({ ...form, pack_unit: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                pack_unit_qty
                <input className={field} value={form.pack_unit_qty} onChange={(e) => setForm({ ...form, pack_unit_qty: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                price_standard
                <input className={field} value={form.price_standard} onChange={(e) => setForm({ ...form, price_standard: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                typical_price_per_unit
                <input className={field} value={form.typical_price_per_unit} onChange={(e) => setForm({ ...form, typical_price_per_unit: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                price_with_loyalty_card
                <input className={field} value={form.price_with_loyalty_card} onChange={(e) => setForm({ ...form, price_with_loyalty_card: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                brand
                <input className={field} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                category
                <input className={field} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                valid_from
                <input type="date" className={field} value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
              </label>
              <label className="text-sm text-slate-700">
                valid_to
                <input type="date" className={field} value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 pt-6 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.has_loyalty_card_price}
                  onChange={(e) =>
                    setForm({ ...form, has_loyalty_card_price: e.target.checked })
                  }
                />
                has_loyalty_card_price
              </label>
              <label className="sm:col-span-2 text-sm text-slate-700">
                notes
                <textarea className={field} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Zavřít
              </button>
              <button
                type="button"
                onClick={onSaveChanges}
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
