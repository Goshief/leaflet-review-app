"use client";

import { useState } from "react";
import { getProductTypeImageUrl, uploadProductTypeImage } from "@/lib/product-types";
import { getAvailableImageKeys, isValidImageKey } from "@/lib/product-types/image-keys";

type RequestRow = {
  id: string;
  batch_item_id: string;
  import_id: string;
  source_table: "offers_raw" | "offers_quarantine";
  product_name: string | null;
  candidate_image_key: string | null;
  source: string;
  status: "pending" | "processing" | "done" | "error";
  resolved_image_key: string | null;
  error_note: string | null;
  created_at: string;
  updated_at?: string;
};

type Props = {
  initialRequests: RequestRow[];
};

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("cs-CZ");
  } catch {
    return iso;
  }
}

export function GenerationRequestsPanel({ initialRequests }: Props) {
  const [rows, setRows] = useState<RequestRow[]>(initialRequests);
  const [filter, setFilter] = useState<"all" | "pending" | "processing" | "error">("all");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resolvedKeyById, setResolvedKeyById] = useState<Record<string, string>>({});
  const [errorNoteById, setErrorNoteById] = useState<Record<string, string>>({});
  const [applyToBatchById, setApplyToBatchById] = useState<Record<string, boolean>>({});
  const imageKeys = getAvailableImageKeys();

  const onUpdate = async (
    row: RequestRow,
    status: "processing" | "done" | "error"
  ) => {
    setError(null);
    setSuccess(null);
    setSavingId(row.id);
    try {
      const res = await fetch("/api/generation-request", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          status,
          resolvedImageKey: status === "done" ? (resolvedKeyById[row.id] ?? "").trim() || null : null,
          errorNote: status === "error" ? (errorNoteById[row.id] ?? "").trim() || null : null,
          // Default: při "hotovo" propsat hned do batch itemu, pokud to operátor výslovně nevypne.
          applyToBatchItem: status === "done" ? applyToBatchById[row.id] !== false : false,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; request?: RequestRow };
      if (!res.ok || !json?.ok || !json.request) {
        throw new Error(json?.error || "Uložení změny stavu selhalo.");
      }
      setRows((prev) => prev.map((r) => (r.id === json.request!.id ? json.request! : r)));
      setSuccess(`Požadavek ${row.id} -> ${status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Uložení změny stavu selhalo.");
    } finally {
      setSavingId(null);
    }
  };

  const onUploadForRequest = async (row: RequestRow, file: File) => {
    setError(null);
    setSuccess(null);
    setSavingId(row.id);
    try {
      const key = await uploadProductTypeImage(file);
      setResolvedKeyById((prev) => ({ ...prev, [row.id]: key }));
      setSuccess(`Soubor nahrán do úložiště jako ${key}. Pak klikni na „Uložit jako hotovo“.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nahrání souboru selhalo.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Požadavky na obrázky</h1>
        <p className="mt-1 text-sm text-slate-600">Operativní fronta bez AI generace ({rows.length} položek).</p>
      </div>

      {success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{success}</div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Žádné požadavky.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">Filtr:</label>
            {([
              ["all", "Vše"],
              ["pending", "Jen čekající"],
              ["processing", "Jen ve zpracování"],
              ["error", "Jen chybové"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${
                  filter === key
                    ? "bg-indigo-600 text-white ring-indigo-600"
                    : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {rows
            .filter((r) => {
              if (filter === "all") return true;
              return r.status === filter;
            })
            .map((r) => {
              const candidateValid = isValidImageKey(r.candidate_image_key ?? null);
              const candidateMissing = !r.candidate_image_key || !candidateValid;
              const pendingHighlight = r.status === "pending";
              return (
                <article
                  key={r.id}
                  className={`rounded-xl border p-4 ${
                    pendingHighlight ? "border-indigo-300 bg-indigo-50/60" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{r.product_name ?? "—"}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {candidateMissing ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          chybí/neznámý key
                        </span>
                      ) : (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                          validní kandidát
                        </span>
                      )}
                      {pendingHighlight ? (
                        <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                          čeká
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <p className="mt-1 text-xs text-slate-600">
                    id: <span className="font-mono">{r.id}</span> · batchItemId:{" "}
                    <span className="font-mono">{r.batch_item_id}</span> · source: {r.source}
                  </p>

              <dl className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-3">
                  <dt className="text-xs text-slate-500">Kandidátní image key</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2">
                    <span>{r.candidate_image_key ?? "—"}</span>
                    {r.candidate_image_key ? (
                      <img
                        src={getProductTypeImageUrl(r.candidate_image_key)}
                        alt=""
                        className="h-10 w-10 rounded object-contain ring-1 ring-slate-200"
                      />
                    ) : null}
                  </dd>
                </div>
                <div><dt className="text-xs text-slate-500">Stav</dt><dd>{r.status}</dd></div>
                <div><dt className="text-xs text-slate-500">Vytvořeno</dt><dd>{fmt(r.created_at)}</dd></div>
              </dl>

              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={savingId === r.id || r.status !== "pending"}
                    onClick={() => void onUpdate(r, "processing")}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-800 disabled:opacity-50"
                  >
                    Označit jako „ve zpracování“
                  </button>
                  <button
                    type="button"
                    disabled={savingId === r.id || r.status === "error"}
                    onClick={() => void onUpdate(r, "done")}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 disabled:opacity-50"
                  >
                    Uložit jako hotovo
                  </button>
                  <button
                    type="button"
                    disabled={savingId === r.id || (r.status !== "pending" && r.status !== "processing")}
                    onClick={() => void onUpdate(r, "error")}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800 disabled:opacity-50"
                  >
                    Označit jako chyba
                  </button>
                </div>

                <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                  <div className="flex min-w-[12rem] flex-col gap-1">
                    <label
                      htmlFor={`resolved-key-${r.id}`}
                      className="text-xs font-medium text-slate-600"
                    >
                      Finální image key
                    </label>
                    <input
                      id={`resolved-key-${r.id}`}
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      value={resolvedKeyById[r.id] ?? r.resolved_image_key ?? ""}
                      onChange={(e) =>
                        setResolvedKeyById((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                      placeholder="např. butter nebo butter.png"
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                      title="Katalogový klíč nebo název souboru v bucketu product-types"
                    />
                  </div>
                  <div className="flex min-w-[12rem] flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600">Vyber key z katalogu</label>
                    <select
                      value={resolvedKeyById[r.id] ?? r.resolved_image_key ?? ""}
                      onChange={(e) =>
                        setResolvedKeyById((prev) => ({ ...prev, [r.id]: e.target.value }))
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
                  </div>
                  <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void onUploadForRequest(r, file);
                      }}
                    />
                    Nahrát soubor
                  </label>
                  {(resolvedKeyById[r.id] ?? r.resolved_image_key) ? (
                    <img
                      src={getProductTypeImageUrl(resolvedKeyById[r.id] ?? r.resolved_image_key)}
                      alt=""
                      className="h-12 w-12 rounded object-contain ring-1 ring-slate-200"
                    />
                  ) : null}
                  <label className="flex cursor-pointer items-center gap-1.5 pb-1 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={applyToBatchById[r.id] !== false}
                      onChange={(e) =>
                        setApplyToBatchById((prev) => ({ ...prev, [r.id]: e.target.checked }))
                      }
                    />
                    propsat do položky v dávce
                  </label>
                </div>
                <p className="text-[11px] leading-snug text-slate-500">
                  Vyber nebo nahraj obrázek, pak klikni na „Uložit jako hotovo“. Se zaškrtnutým
                  „propsat do položky v dávce“ se zapíše `approved_image_key` do `offers_raw/offers_quarantine`.
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id={`error-note-${r.id}`}
                    value={errorNoteById[r.id] ?? r.error_note ?? ""}
                    onChange={(e) =>
                      setErrorNoteById((prev) => ({ ...prev, [r.id]: e.target.value }))
                    }
                    placeholder="poznámka k chybě (volitelné)"
                    className="min-w-[10rem] flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                  />
                </div>
              </div>
                </article>
              );
            })}
        </div>
      )}
    </section>
  );
}

