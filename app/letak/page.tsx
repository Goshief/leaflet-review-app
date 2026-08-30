"use client";

import { LeafletA4Viewer } from "@/components/leaflet/a4-viewer";
import { useLeafletPreview } from "@/components/leaflet/preview-context";
import { leafletOffersToCsv } from "@/lib/leaflet/offers-csv";
import { getPdfPageCount, renderPdfPageToPngFile } from "@/lib/pdf/render-page";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export default function LetakA4Page() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const preview = useLeafletPreview();
  const router = useRouter();
  const file = preview.kind === "pdf" ? preview.file : null;
  const [reading, setReading] = useState("");
  const [error, setError] = useState("");

  async function readAllPages() {
    if (!file) return;
    setError("");
    try {
      const count = await getPdfPageCount(file);
      const rows: Array<Record<string, unknown>> = [];
      for (let page = 1; page <= count; page += 1) {
        setReading(`Převádím stranu ${page}/${count} na A4 obrázek a čtu ji…`);
        const image = await renderPdfPageToPngFile(file, page);
        const body = new FormData();
        body.append("file", image);
        body.append("page_no", String(page));
        const response = await fetch("/api/extract", { method: "POST", body });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          rows.push({ page_no: page, notes: data?.error || `HTTP ${response.status}`, extracted_name: "CHYBA ČTENÍ" });
          continue;
        }
        const offers = Array.isArray(data?.offers) ? data.offers : [];
        if (offers.length === 0) {
          rows.push({ page_no: page, notes: "strana bez produktu", extracted_name: null });
        } else {
          for (const offer of offers) rows.push({ ...offer, page_no: page });
        }
      }
      const csv = leafletOffersToCsv(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(file.name || "letak").replace(/\.pdf$/i, "")}-produkty.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setReading(`Hotovo: ${rows.length} řádků z ${count} stran. CSV je ke stažení.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setReading("");
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Leták po stranách A4</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          12–15 letáků × ~50 stran × ~10 produktů je ~7 500 položek týdně. To nejde číst z celého PDF.
          Nejdřív se leták rozloží na A4 obrázky — to je formát, který čtečka zaručeně zvládne.
          Pak se čte jedna strana po druhé, zapisuje a kontroluje.
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-3">
        <li className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">1</p>
          <p className="mt-1 font-semibold">Rozkouskovat na A4</p>
          <p className="mt-1 text-sm text-slate-600">PDF → jedna strana = jeden obrázek.</p>
        </li>
        <li className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">2</p>
          <p className="mt-1 font-semibold">Číst stranu po straně</p>
          <p className="mt-1 text-sm text-slate-600">OCR/vision jen na ten obrázek, ne na celý leták.</p>
        </li>
        <li className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">3</p>
          <p className="mt-1 font-semibold">Zapsat a zkontrolovat</p>
          <p className="mt-1 text-sm text-slate-600">CSV teď, do Supabase až databáze zase běží.</p>
        </li>
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white"
        >
          {file ? "Otevřít jiné PDF" : "Otevřít PDF leták"}
        </button>
        {file ? (
          <button
            type="button"
            disabled={Boolean(reading) && !reading.startsWith("Hotovo")}
            onClick={() => void readAllPages()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            Číst všechny strany do CSV
          </button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) preview.setFromFile(next);
          }}
        />
      </div>
      {reading ? <p className="rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{reading}</p> : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}

      {file ? (
        <LeafletA4Viewer
          file={file}
          title={preview.fileName || file.name}
          onReadPage={(pageNo) => {
            sessionStorage.setItem("letak-page", String(pageNo));
            router.push("/review");
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const next = event.dataTransfer.files?.[0];
            if (next) preview.setFromFile(next);
          }}
          className="flex min-h-72 w-full flex-col items-center justify-center rounded-[2rem] border-2 border-dashed border-slate-300 bg-white text-slate-600"
        >
          <span className="text-lg font-bold text-slate-900">Přetáhni sem PDF leták</span>
          <span className="mt-2 text-sm">Rozloží se na A4 strany. Pak je čteme jednu po druhé.</span>
        </button>
      )}
    </main>
  );
}
