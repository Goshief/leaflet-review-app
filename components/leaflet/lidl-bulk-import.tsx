"use client";

import { useState, type FormEvent } from "react";

type ImportResult = {
  ok: boolean; error?: string; import_id?: string; source_count?: number;
  inserted?: number; skipped?: number; invalid?: number; link?: string;
};

export function LidlBulkImport() {
  const [file, setFile] = useState<File | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !token || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/bulk-import-lidl", {
        method: "POST", headers: { "x-bulk-import-token": token }, body: form,
      });
      const payload = (await response.json()) as ImportResult;
      setResult(payload);
      if (payload.ok) setFile(null);
    } catch {
      setResult({ ok: false, error: "Spojení se serverem selhalo. Zkontrolujte stav importu před opakováním." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-slate-900">Lidl: import jedním kliknutím</h2>
      <p className="mt-2 text-sm text-slate-600">
        Nahrajte CSV s hlavičkou product_id/nazev/cena/platnost_od/platnost_do
        nebo SQLite export Setrik (.sqlite3). Pouze schválené nabídky Lidlu;
        ostatních obchodů se import netýká. Opakované nahrání stejného letáku
        nezdvojí nabídky.
      </p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label className="block text-sm font-semibold text-slate-700" htmlFor="lidl-bulk-file">Soubor</label>
        <input id="lidl-bulk-file" type="file" accept=".csv,.sqlite3,.sqlite,.db"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }}
          className="block w-full rounded-lg border border-slate-300 p-2 text-sm" required />
        <label className="block text-sm font-semibold text-slate-700" htmlFor="lidl-import-key">
          Importní klíč (BULK_IMPORT_TOKEN)
        </label>
        <input id="lidl-import-key" type="password" autoComplete="off"
          value={token} onChange={(e) => setToken(e.target.value)}
          className="block w-full rounded-lg border border-slate-300 p-2 text-sm"
          placeholder="Importní klíč nastavený na serveru" required />
        <button type="submit" disabled={!file || !token || busy}
          className="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "Importuji…" : "Importovat Lidl do Supabase"}
        </button>
      </form>
      {result && (
        <div role="status" className={`mt-5 rounded-xl p-4 text-sm ${result.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
          {result.ok ? (
            <p>
              Hotovo. Zdroj: {result.source_count}, nově vloženo: {result.inserted},
              přeskočeno jako duplicita: {result.skipped}.
              {" "}<a className="font-semibold underline" href={result.link}>Otevřít dávku</a>
            </p>
          ) : <p>Import se nepodařil: {result.error}</p>}
        </div>
      )}
    </section>
  );
}
