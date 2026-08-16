import Link from "next/link";
import { logoutAction } from "@/app/login/actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bez oprávnění · Letáky Admin",
  robots: { index: false, follow: false },
};

/**
 * Authenticated user without operator/admin role lands here.
 * Must not itself require an admin role (avoids redirect loops).
 */
export default function ForbiddenPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Nemáte oprávnění
        </h1>
        <p className="text-sm text-slate-600">
          Jste přihlášeni, ale tento účet nemá přístup do administrace Letáky
          Admin. Přihlášení a oprávnění jsou oddělené — kontaktujte správce,
          pokud přístup potřebujete.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/login"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
          >
            Zpět na přihlášení
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
            >
              Odhlásit
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
