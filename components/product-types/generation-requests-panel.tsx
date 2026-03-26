"use client";

import { useState } from "react";
import { isValidImageKey } from "@/lib/product-types/image-keys";

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

  const onUpdate = async (
    row: RequestRow,
    status: "processing" | "done" | "error"
  ) => {
    setError(null);
    setSuccess(null);
    setSavingId(row.id);
    try {
      const res = await fetch("/api/product-types/generation-request", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          status,
          resolvedImageKey: status === "done" ? (resolvedKeyById[row.id] ?? "").trim() || null : null,
          errorNote: status === "error" ? (errorNoteById[row.id] ?? "").trim() || null : null,
          applyToBatchItem: status === "done" ? applyToBatchById[row.id] === true : false,
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

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Požadavky na obrázky</h1>
        <p className="mt-1 text-sm text-slate-600">Operativní queue bez AI generace ({rows.length} položek).</p>
      </div>

      {success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{success}</div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Žádné generation requesty.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">Filtr:</label>
            {([
              ["all", "All"],
              ["pending", "Pending only"],
              ["processing", "Processing only"],
              ["error", "Error only"],
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
                          missing/unknown key
                        </span>
                      ) : (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                          valid candidate key
                        </span>
                      )}
                      {pendingHighlight ? (
                        <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                          pending
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <p className="mt-1 text-xs text-slate-600">
                    id: <span className="font-mono">{r.id}</span> · batchItemId:{" "}
                    <span className="font-mono">{r.batch_item_id}</span> · source: {r.source}
                  </p>

              <dl className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
                <div><dt className="text-xs text-slate-500">candidateImageKey</dt><dd>{r.candidate_image_key ?? "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">status</dt><dd>{r.status}</dd></div>
                <div><dt className="text-xs text-slate-500">createdAt</dt><dd>{fmt(r.created_at)}</dd></div>
              </dl>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={savingId === r.id || r.status !== "pending"}
                  onClick={() => void onUpdate(r, "processing")}
                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-800 disabled:opacity-50"
                >
                  Mark as processing
                </button>

                <input
                  value={resolvedKeyById[r.id] ?? r.resolved_image_key ?? ""}
                  onChange={(e) =>
                    setResolvedKeyById((prev) => ({ ...prev, [r.id]: e.target.value }))
                  }
                  placeholder="final image key"
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                />
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={applyToBatchById[r.id] === true}
                    onChange={(e) =>
                      setApplyToBatchById((prev) => ({ ...prev, [r.id]: e.target.checked }))
                    }
                  />
                  propsat do batch item
                </label>
                <button
                  type="button"
                  disabled={savingId === r.id || r.status !== "processing"}
                  onClick={() => void onUpdate(r, "done")}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 disabled:opacity-50"
                >
                  Mark as done
                </button>

                <input
                  value={errorNoteById[r.id] ?? r.error_note ?? ""}
                  onChange={(e) =>
                    setErrorNoteById((prev) => ({ ...prev, [r.id]: e.target.value }))
                  }
                  placeholder="error note"
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                />
                <button
                  type="button"
                  disabled={savingId === r.id || (r.status !== "pending" && r.status !== "processing")}
                  onClick={() => void onUpdate(r, "error")}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800 disabled:opacity-50"
                >
                  Mark as error
                </button>
              </div>
                </article>
              );
            })}
        </div>
      )}
    </section>
  );
}

