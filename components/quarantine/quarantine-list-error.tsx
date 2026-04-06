import Link from "next/link";
import { quarantineLocalHref, reviewQuarantineHref } from "@/lib/nav/quarantine";

/** Supabase je nakonfigurované, ale dotaz na karanténu selhal — nelze zaměnit za lokální řádky. */
export function QuarantineListError({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10" data-testid="quarantine-db-error">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Karanténa (databáze)</h1>
        <p className="mt-2 text-slate-600">
          Nepodařilo se načíst databázovou karanténu. Zkontroluj oprávnění service role a schéma tabulky{" "}
          <code className="rounded bg-slate-100 px-1 text-sm">offers_quarantine</code>.
        </p>
      </div>
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 font-mono text-xs text-rose-950 break-words">
        {message}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link
          href="/quarantine"
          className="inline-flex justify-center rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
        >
          Zkusit znovu (reload stránky)
        </Link>
        <Link
          href={quarantineLocalHref()}
          className="inline-flex justify-center rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
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
