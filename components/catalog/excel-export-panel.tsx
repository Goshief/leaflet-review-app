"use client";

import { useEffect, useState } from "react";

const RETAILERS = [
  { id: "lidl", name: "Lidl" },
  { id: "rossmann", name: "Rossmann" },
  { id: "rohlik", name: "Rohlík" },
  { id: "billa", name: "BILLA" },
  { id: "teta", name: "Teta" },
  { id: "dm", name: "dm" },
] as const;

type SnapshotFile = {
  name: string;
  url: string;
  bytes: number;
  updatedAt: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export function CatalogExcelExportPanel() {
  const [files, setFiles] = useState<SnapshotFile[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function loadFiles() {
    try {
      const response = await fetch("/api/catalog/files", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error || `HTTP ${response.status}`);
      setFiles(body.files || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void loadFiles();
  }, []);

  async function refresh(retailer: string) {
    setWorking(retailer);
    setError("");
    setNotice(`Stahuji ${retailer} z webu a ukládám do Excelu…`);
    try {
      const response = await fetch(`/api/catalog/export?retailer=${encodeURIComponent(retailer)}&limit=40`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `catalog-${retailer}-latest.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      const saved = response.headers.get("X-Catalog-Saved") || "?";
      setNotice(`${retailer}: uloženo ${saved} produktů. Soubor zůstává ke stažení níže.`);
      await loadFiles();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNotice("");
    } finally {
      setWorking(null);
    }
  }

  const allFile = files.find((file) => file.name === "catalog-all-latest.xlsx");

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-slate-900">Katalog v Excelu — ke stažení kdykoliv</h2>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        Soubory jsou uložené v aplikaci. Stáhneš je hned, bez čekání na crawl a bez Supabase.
        Tlačítka dole jen obnoví snapshot z webu obchodu.
      </p>
      {notice ? <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{notice}</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}

      <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
        {allFile ? (
          <a
            href={`/api/catalog/files/${encodeURIComponent(allFile.name)}`}
            className="inline-flex rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white"
          >
            Stáhnout vše (.xlsx) · {formatBytes(allFile.bytes)} · {formatWhen(allFile.updatedAt)}
          </a>
        ) : (
          <p className="text-sm font-medium text-indigo-900">Společný Excel se ještě generuje.</p>
        )}
      </div>

      <ul className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200">
        {files.filter((file) => file.name !== "catalog-all-latest.xlsx").map((file) => (
          <li key={file.name} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-semibold text-slate-900">{file.name}</p>
              <p className="text-xs text-slate-500">
                {formatBytes(file.bytes)} · uloženo {formatWhen(file.updatedAt)}
              </p>
            </div>
            <a
              href={`/api/catalog/files/${encodeURIComponent(file.name)}`}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white"
            >
              Stáhnout
            </a>
          </li>
        ))}
        {files.length === 0 ? (
          <li className="px-4 py-3 text-sm text-slate-600">Zatím žádný uložený Excel. Spusť obnovení níže.</li>
        ) : null}
      </ul>

      <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-slate-500">Obnovit z webu</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RETAILERS.map((retailer) => (
          <button
            key={retailer.id}
            disabled={working != null}
            onClick={() => void refresh(retailer.id)}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-left text-sm font-bold text-slate-800 disabled:opacity-40"
          >
            {working === retailer.id ? `Obnovuji ${retailer.name}…` : `Obnovit ${retailer.name}`}
          </button>
        ))}
      </div>
    </section>
  );
}
