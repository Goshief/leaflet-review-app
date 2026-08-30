"use client";

import { useState } from "react";

const RETAILERS = [
  { id: "lidl", name: "Lidl" },
  { id: "rossmann", name: "Rossmann" },
  { id: "rohlik", name: "Rohlík" },
  { id: "billa", name: "BILLA" },
  { id: "teta", name: "Teta" },
  { id: "dm", name: "dm" },
] as const;

export function CatalogExcelExportPanel() {
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function download(retailer: string) {
    setWorking(retailer);
    setError("");
    setNotice(`Stahuji ${retailer} do Excelu. Trvá to minutu, počkej…`);
    try {
      const response = await fetch(`/api/catalog/export?retailer=${encodeURIComponent(retailer)}&limit=12`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      link.href = url;
      link.download = `catalog-${retailer}-${stamp}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      const saved = response.headers.get("X-Catalog-Saved") || "?";
      setNotice(`${retailer}: staženo ${saved} produktů do Excelu. Kopii najdeš i ve složce exports/.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNotice("");
    } finally {
      setWorking(null);
    }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-slate-900">Katalog do Excelu</h2>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        Supabase teď není potřeba. Stáhne se veřejný katalog obchodu a uloží do Excelu. Až databáze poběží,
        stejný soubor (nebo CSV ve složce <code>exports/</code>) nahrajeme do tabulek.
      </p>
      {notice ? <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{notice}</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RETAILERS.map((retailer) => (
          <button
            key={retailer.id}
            disabled={working != null}
            onClick={() => void download(retailer.id)}
            className="rounded-2xl bg-indigo-600 px-4 py-3 text-left text-sm font-bold text-white disabled:opacity-40"
          >
            {working === retailer.id ? `Stahuji ${retailer.name}…` : `Stáhnout ${retailer.name} (.xlsx)`}
          </button>
        ))}
      </div>
    </section>
  );
}
