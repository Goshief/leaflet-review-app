import Link from "next/link";
import { LocalQuarantine } from "@/components/quarantine/local-quarantine";
import { quarantineHomeHref } from "@/lib/nav/quarantine";

export const dynamic = "force-dynamic";

export default function QuarantineLocalPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-0" data-testid="quarantine-local-page">
      <div
        className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm"
        data-testid="quarantine-local-banner"
      >
        <p className="font-semibold text-amber-950">Toto není databázová karanténa</p>
        <p className="mt-1 text-amber-900/90">
          Zobrazují se pouze položky označené jako karanténa v rozpracované kontrole (prohlížeč / lokální session).
          Globální pravda je v{" "}
          <Link href={quarantineHomeHref()} className="font-semibold text-indigo-800 underline">
            Karanténa (databáze)
          </Link>
          .
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Lokální karanténa
          </h1>
          <p className="mt-2 text-slate-600">
            Karanténa z rozpracované kontroly — nejde o tabulku <code className="rounded bg-slate-100 px-1">offers_quarantine</code>{" "}
            v Supabase.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={quarantineHomeHref()}
            className="text-sm font-semibold text-indigo-700 hover:underline"
          >
            Databázová karanténa →
          </Link>
          <Link href="/review" className="text-sm font-semibold text-slate-700 hover:underline">
            Ke kontrole →
          </Link>
          <Link href="/upload" className="text-sm font-semibold text-slate-700 hover:underline">
            Nahrát →
          </Link>
        </div>
      </div>

      <LocalQuarantine />
    </main>
  );
}
