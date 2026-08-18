"use client";

import { useEffect, useState } from "react";

type HistoryItem = {
  retailer: string;
  pdf: string;
  created_at: string | null;
  status: "staženo" | "čeká na schválení" | "rozpracováno" | "hotovo";
  page_count: number | null;
  processed_pages: number;
  approved_count: number;
  quarantine_count: number;
  valid_from: string | null;
  valid_to: string | null;
};

function when(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function statusClass(status: HistoryItem["status"]) {
  if (status === "hotovo") return "bg-emerald-50 text-emerald-700";
  if (status === "rozpracováno") return "bg-blue-50 text-blue-700";
  if (status === "čeká na schválení") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

export function LeafletHistoryPanel() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/leaflet-monitor/history", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      setItems(data.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Historii letáků se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <section className="mb-10 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Historie stažených letáků</h2>
          <p className="mt-1 text-sm text-slate-600">Jeden řádek = jeden konkrétní PDF leták a jeho skutečný stav zpracování.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">{loading ? "Načítám…" : "Obnovit"}</button>
      </div>

      {error ? <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="p-2">Obchod</th>
              <th className="p-2">Leták</th>
              <th className="p-2">Staženo</th>
              <th className="p-2">Platnost</th>
              <th className="p-2">Stav</th>
              <th className="p-2">Strany</th>
              <th className="p-2">Schválené</th>
              <th className="p-2">Karanténa</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.retailer}/${item.pdf}`} className="border-b border-slate-100 align-top">
                <td className="p-2 font-bold capitalize">{item.retailer}</td>
                <td className="max-w-[320px] break-all p-2">{item.pdf}</td>
                <td className="p-2 whitespace-nowrap">{when(item.created_at)}</td>
                <td className="p-2 whitespace-nowrap">{item.valid_from || item.valid_to ? `${item.valid_from ?? "?"} → ${item.valid_to ?? "?"}` : "—"}</td>
                <td className="p-2"><span className={`rounded-full px-2 py-1 font-bold ${statusClass(item.status)}`}>{item.status}</span></td>
                <td className="p-2 whitespace-nowrap">{item.page_count ? `${item.processed_pages}/${item.page_count}` : "—"}</td>
                <td className="p-2">{item.approved_count}</td>
                <td className="p-2">{item.quarantine_count}</td>
              </tr>
            ))}
            {!loading && items.length === 0 ? <tr><td colSpan={8} className="p-4 text-center text-slate-500">Zatím není uložený žádný leták.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
