"use client";

import { useEffect, useState } from "react";

type VerifiedOffer = { extracted_name?: string | null; price_total?: number | null; price_standard?: number | null; price_with_loyalty_card?: number | null; valid_from?: string | null; valid_to?: string | null; brand?: string | null; category?: string | null; confidence?: number | null; status: "approved" | "quarantine"; verification_reason?: string | null; [key: string]: unknown; };
type RetailerRow = { id: string; name: string; source_url: string; connector: "active" | "pending"; pdf_count: number; latest_pdf: string | null; last_check: { status?: string; checked_at?: string; error?: string } | null; learning: { confidence: number; preferred_weekdays: number[]; checks_this_week_limit: number; last_check_at: string | null; last_visit_at: string | null; last_visit_url: string | null; last_downloaded_at: string | null; next_check_at: string | null; download_hits: number[]; }; ai: { page_count: number | null; processed_pages: number; completed: boolean; next_page: number | null } | null; };
type PageReview = { retailer: string; page: number; page_count: number; approved_count: number; quarantine_count: number; verified_offers: VerifiedOffer[]; };

const DAYS = ["ne", "po", "út", "st", "čt", "pá", "so"];
function when(value: string | null | undefined) { if (!value) return "—"; return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function statusLabel(row: RetailerRow) { if (row.connector === "pending") return "Čeká na konektor"; if (row.ai?.completed) return "AI hotovo"; if (row.ai?.page_count) return `AI ${row.ai.processed_pages}/${row.ai.page_count}`; if (row.last_check?.status === "downloaded") return "Nový leták stažen"; if (row.last_check?.status === "unchanged") return "Beze změny"; if (row.last_check?.status === "error") return "Chyba kontroly"; return "Připraveno k učení"; }
function errorMessage(value: unknown, fallback: string) { if (value instanceof Error) return value.message; if (typeof value === "string") return value; if (value && typeof value === "object") { const row = value as Record<string, unknown>; if (typeof row.error === "string") return row.error; if (typeof row.message === "string") return row.message; } return fallback; }

export function LeafletMonitorPanel() {
  const [rows, setRows] = useState<RetailerRow[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [review, setReview] = useState<PageReview | null>(null);

  async function load() {
    setLoading(true); setError("");
    try { const response = await fetch("/api/leaflet-monitor/status", { cache: "no-store" }); const data = await response.json(); if (!response.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${response.status}`); setRows(data.retailers ?? []); }
    catch (cause) { setError(errorMessage(cause, "Stav letáků se nepodařilo načíst.")); }
    finally { setLoading(false); }
  }

  async function runCheck(row: RetailerRow) {
    setWorking(row.id); setError(""); setNotice(`Kontroluji ${row.name}…`);
    try {
      const response = await fetch(`/api/cron/fetch-${row.id}-leaflet?manual=1`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(errorMessage(data, `Kontrola selhala (HTTP ${response.status}).`));
      const label = data.status === "downloaded" ? "nový leták stažen" : data.status === "unchanged" ? "leták beze změny" : data.status ?? "kontrola dokončena";
      setNotice(`${row.name}: ${label}.`);
      await load();
    } catch (cause) { setError(errorMessage(cause, `Kontrola ${row.name} selhala.`)); setNotice(""); }
    finally { setWorking(null); }
  }

  async function testPage(row: RetailerRow) {
    if (!row.latest_pdf) return; const page = row.ai?.next_page && row.ai.next_page <= (row.ai.page_count ?? Infinity) ? row.ai.next_page : 1;
    setWorking(row.id); setError(""); setNotice(""); setReview(null);
    try {
      const response = await fetch("/api/leaflet-ai/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bucket: "leaflet-intake", path: `${row.id}/${row.latest_pdf}`, retailer: row.id, page, dry_run: true }) });
      const data = await response.json(); if (!response.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      setReview({ retailer: row.id, page: data.page, page_count: data.page_count, approved_count: data.approved_count ?? 0, quarantine_count: data.quarantine_count ?? 0, verified_offers: data.verified_offers ?? [] });
    } catch (cause) { setError(errorMessage(cause, "AI test stránky selhal.")); }
    finally { setWorking(null); }
  }

  async function approveReview() {
    if (!review) return; const row = rows.find((x) => x.id === review.retailer); if (!row?.latest_pdf) return;
    setWorking(review.retailer); setError("");
    try {
      const response = await fetch("/api/leaflet-ai/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bucket: "leaflet-intake", path: `${row.id}/${row.latest_pdf}`, page: review.page, verified_offers: review.verified_offers }) });
      const data = await response.json(); if (!response.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      setReview(null); setNotice(data.completed ? `${row.name}: celý leták je hotový.` : `${row.name}: strana ${review.page} zapsaná. Další je ${data.next_page}.`); await load();
    } catch (cause) { setError(errorMessage(cause, "Schválení stránky selhalo.")); }
    finally { setWorking(null); }
  }

  useEffect(() => { void load(); }, []);

  return (
    <section className="mb-10 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">Automatické hlídání letáků</h2><p className="mt-1 max-w-3xl text-sm text-slate-600">Systém eviduje skutečné návštěvy webů, učí se dny zveřejnění a na každý obchod pustí robota maximálně 2× týdně. Tlačítkem můžeš kdykoli vynutit ruční kontrolu.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">{loading ? "Načítám…" : "Obnovit"}</button></div>
      {notice ? <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-700">{notice}</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}

      <div className="mt-5 grid gap-3 lg:grid-cols-5">
        {rows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-2"><h3 className="font-bold text-slate-900">{row.name}</h3><span className={row.connector === "active" ? "rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700" : "rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700"}>{row.connector === "active" ? "aktivní" : "čeká"}</span></div>
            <p className="mt-3 text-sm font-semibold text-slate-800">{statusLabel(row)}</p>
            <dl className="mt-3 space-y-2 text-xs text-slate-600">
              <div><dt className="font-semibold text-slate-500">PDF v úložišti</dt><dd>{row.pdf_count}</dd></div><div><dt className="font-semibold text-slate-500">Robot naposledy na webu</dt><dd>{when(row.learning.last_visit_at)}</dd></div><div><dt className="font-semibold text-slate-500">Poslední výsledek kontroly</dt><dd>{when(row.learning.last_check_at)}</dd></div><div><dt className="font-semibold text-slate-500">Poslední nový leták</dt><dd>{when(row.learning.last_downloaded_at)}</dd></div><div><dt className="font-semibold text-slate-500">Další doporučená návštěva</dt><dd>{when(row.learning.next_check_at)}</dd></div><div><dt className="font-semibold text-slate-500">Naučené dny</dt><dd>{row.learning.preferred_weekdays.map((d) => DAYS[d] ?? "?").join(" + ")}</dd></div><div><dt className="font-semibold text-slate-500">Jistota učení</dt><dd>{Math.round((row.learning.confidence ?? 0) * 100)} %</dd></div>{row.latest_pdf ? <div><dt className="font-semibold text-slate-500">Poslední PDF</dt><dd className="break-all">{row.latest_pdf}</dd></div> : null}
            </dl>
            <div className="mt-3 flex flex-col gap-2">
              <button type="button" disabled={working === row.id} onClick={() => void runCheck(row)} className="rounded-lg bg-indigo-600 px-2.5 py-2 text-xs font-bold text-white disabled:opacity-50">{working === row.id ? "Kontroluji…" : "Zkontrolovat web teď"}</button>
              {row.latest_pdf ? <button type="button" disabled={working === row.id} onClick={() => void testPage(row)} className="rounded-lg bg-slate-900 px-2.5 py-2 text-xs font-bold text-white disabled:opacity-50">{working === row.id ? "AI pracuje…" : `Otestovat stranu ${row.ai?.next_page ?? 1}`}</button> : null}
              <a href={row.learning.last_visit_url || row.source_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-600 hover:underline">Kontrolovaný web ↗</a>
            </div>
          </article>
        ))}
      </div>

      {review ? <div className="mt-6 rounded-2xl border-2 border-indigo-200 bg-indigo-50/40 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold text-slate-900">AI kontrola: {review.retailer} · strana {review.page}/{review.page_count}</h3><p className="text-sm text-slate-600">Bez zápisu do databáze. Bezpečné: {review.approved_count}, karanténa: {review.quarantine_count}.</p></div><div className="flex gap-2"><button type="button" onClick={() => setReview(null)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">Zahodit</button><button type="button" disabled={working === review.retailer} onClick={() => void approveReview()} className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Schválit stránku a zapsat</button></div></div><div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead><tr className="border-b border-slate-200 text-slate-500"><th className="p-2">Stav</th><th className="p-2">Produkt</th><th className="p-2">Cena</th><th className="p-2">Původní</th><th className="p-2">Platnost</th><th className="p-2">Jistota</th><th className="p-2">Kontrola</th></tr></thead><tbody>{review.verified_offers.map((offer, index) => <tr key={index} className="border-b border-slate-100 align-top"><td className="p-2 font-bold">{offer.status}</td><td className="p-2">{offer.extracted_name ?? "—"}</td><td className="p-2">{offer.price_total ?? "—"}</td><td className="p-2">{offer.price_standard ?? "—"}</td><td className="p-2">{offer.valid_from ?? "—"} → {offer.valid_to ?? "—"}</td><td className="p-2">{offer.confidence == null ? "—" : `${Math.round(offer.confidence * 100)} %`}</td><td className="p-2">{offer.verification_reason ?? "OK"}</td></tr>)}</tbody></table></div></div> : null}
    </section>
  );
}
