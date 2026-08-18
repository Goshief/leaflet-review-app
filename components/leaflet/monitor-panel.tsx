"use client";

import { useEffect, useState } from "react";

type RetailerRow = {
  id: string;
  name: string;
  source_url: string;
  connector: "active" | "pending";
  pdf_count: number;
  latest_pdf: string | null;
  last_check: { status?: string; checked_at?: string; error?: string } | null;
  learning: {
    confidence: number;
    preferred_weekdays: number[];
    checks_this_week_limit: number;
    last_check_at: string | null;
    last_visit_at: string | null;
    last_visit_url: string | null;
    last_downloaded_at: string | null;
    next_check_at: string | null;
    download_hits: number[];
  };
  ai: { page_count: number | null; processed_pages: number; completed: boolean; next_page: number | null } | null;
};

const DAYS = ["ne", "po", "út", "st", "čt", "pá", "so"];

function when(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(row: RetailerRow) {
  if (row.connector === "pending") return "Čeká na konektor";
  if (row.ai?.completed) return "AI hotovo";
  if (row.ai?.page_count) return `AI ${row.ai.processed_pages}/${row.ai.page_count}`;
  if (row.last_check?.status === "downloaded") return "Nový leták stažen";
  if (row.last_check?.status === "unchanged") return "Beze změny";
  if (row.last_check?.status === "error") return "Chyba kontroly";
  return "Připraveno k učení";
}

export function LeafletMonitorPanel() {
  const [rows, setRows] = useState<RetailerRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/leaflet-monitor/status", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      setRows(data.retailers ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stav letáků se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <section className="mb-10 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Automatické hlídání letáků</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Systém eviduje každou skutečnou návštěvu webu obchodu, učí se dny zveřejnění a na každý obchod pustí robota maximálně 2× týdně.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
          {loading ? "Načítám…" : "Obnovit"}
        </button>
      </div>

      {error ? <p className="mt-4 text-sm font-medium text-rose-700">{error}</p> : null}

      <div className="mt-5 grid gap-3 lg:grid-cols-5">
        {rows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-slate-900">{row.name}</h3>
              <span className={row.connector === "active" ? "rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700" : "rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700"}>
                {row.connector === "active" ? "aktivní" : "čeká"}
              </span>
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-800">{statusLabel(row)}</p>
            <dl className="mt-3 space-y-2 text-xs text-slate-600">
              <div><dt className="font-semibold text-slate-500">PDF v úložišti</dt><dd>{row.pdf_count}</dd></div>
              <div><dt className="font-semibold text-slate-500">Robot naposledy na webu</dt><dd>{when(row.learning.last_visit_at)}</dd></div>
              <div><dt className="font-semibold text-slate-500">Poslední výsledek kontroly</dt><dd>{when(row.learning.last_check_at)}</dd></div>
              <div><dt className="font-semibold text-slate-500">Poslední nový leták</dt><dd>{when(row.learning.last_downloaded_at)}</dd></div>
              <div><dt className="font-semibold text-slate-500">Další doporučená návštěva</dt><dd>{when(row.learning.next_check_at)}</dd></div>
              <div><dt className="font-semibold text-slate-500">Naučené dny</dt><dd>{row.learning.preferred_weekdays.map((d) => DAYS[d] ?? "?").join(" + ")}</dd></div>
              <div><dt className="font-semibold text-slate-500">Jistota učení</dt><dd>{Math.round((row.learning.confidence ?? 0) * 100)} %</dd></div>
            </dl>
            <a href={row.learning.last_visit_url || row.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-semibold text-indigo-600 hover:underline">Poslední kontrolovaný web ↗</a>
          </article>
        ))}
      </div>
    </section>
  );
}
