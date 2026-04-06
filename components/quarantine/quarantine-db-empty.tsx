import Link from "next/link";
import { quarantineLocalHref } from "@/lib/nav/quarantine";

/**
 * Tabulka offers_quarantine je prázdná — jiný význam než chyba dotazu nebo chybějící env.
 */
export function QuarantineDbEmpty() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10" data-testid="quarantine-db-empty">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Karanténa (databáze)</h1>
        <p className="mt-2 text-slate-600">
          V databázové karanténě (<code className="rounded bg-slate-100 px-1 text-sm">offers_quarantine</code>) zatím
          nic není.
        </p>
      </div>
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-slate-600">
          Žádné řádky k zobrazení. Nové položky sem přibudou po označení v kontrole a commitu do databáze.
        </p>
        <div className="mt-5 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/batches"
            className="inline-flex rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700"
          >
            Dávky →
          </Link>
          <Link
            href="/review"
            className="inline-flex rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Ke kontrole →
          </Link>
          <Link
            href="/upload"
            className="inline-flex rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Nahrát leták →
          </Link>
          <Link
            href={quarantineLocalHref()}
            className="text-sm font-semibold text-indigo-700 hover:underline"
          >
            Lokální karanténa z kontroly
          </Link>
        </div>
      </div>
    </main>
  );
}
