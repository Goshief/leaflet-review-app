import Link from "next/link";
import { quarantineLocalHref, reviewQuarantineHref } from "@/lib/nav/quarantine";

/**
 * Supabase admin klient není dostupný — databázová karanténa nelze načíst.
 * Nesmí se zaměnit za prázdný seznam ani za lokální karanténu.
 */
export function QuarantineDbNotConfigured({ message }: { message: string }) {
  return (
    <main
      className="mx-auto max-w-2xl space-y-6 px-4 py-10"
      data-testid="quarantine-db-not-configured"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Karanténa (databáze)</h1>
        <p className="mt-2 text-slate-600">
          Databázová karanténa není na tomto nasazení dostupná — chybí serverové připojení k Supabase
          (service role pro načtení <code className="rounded bg-slate-100 px-1 text-sm">offers_quarantine</code>).
        </p>
      </div>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        {message}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link
          href={quarantineLocalHref()}
          className="inline-flex justify-center rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
        >
          Lokální karanténa z kontroly →
        </Link>
        <Link
          href={reviewQuarantineHref()}
          className="inline-flex justify-center rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-2.5 text-sm font-semibold text-indigo-900 hover:bg-indigo-100"
        >
          Karanténa v kontrole (review) →
        </Link>
        <Link
          href="/"
          className="inline-flex justify-center rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-700"
        >
          Zpět na přehled
        </Link>
      </div>
    </main>
  );
}
