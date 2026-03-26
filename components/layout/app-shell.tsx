"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

function navItem(href: string, pathname: string, label: string, icon: string) {
  const active =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={
        active
          ? "flex items-center gap-3 rounded-xl bg-indigo-500/15 px-3 py-2.5 text-sm font-semibold text-white ring-1 ring-indigo-400/30"
          : "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
      }
    >
      <span className="text-lg opacity-90" aria-hidden>
        {icon}
      </span>
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800/60 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 lg:flex">
        <div className="p-6 pb-2">
          <Link href="/" className="block text-lg font-bold tracking-tight text-white">
            Letáky <span className="text-indigo-400">Admin</span>
          </Link>
          <p className="mt-1 text-xs text-slate-500">Staging &amp; kontrola</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
          {navItem("/", pathname, "Přehled", "📊")}
          {navItem("/batches", pathname, "Dávky", "📄")}
          {navItem("/quarantine", pathname, "Karanténa", "🗂")}
          {navItem("/upload", pathname, "Nahrát", "⬆")}
          {navItem("/review", pathname, "Ke kontrole", "✓")}
          {navItem("/history", pathname, "Historie", "🕘")}
          {navItem("/image-generation-requests", pathname, "Požadavky na obrázky", "🖼")}
          {navItem("/parsers", pathname, "Parsery", "🧩")}
          {navItem("/settings", pathname, "Nastavení", "⚙")}
        </nav>
        <div className="border-t border-white/5 p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            Brzy
          </p>
          <span className="mt-1 block cursor-not-allowed text-sm text-slate-600">
            Importováno
          </span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex min-h-14 shrink-0 flex-col gap-2 border-b border-slate-200/90 bg-white/95 px-4 py-2 backdrop-blur-md md:px-8 lg:flex-row lg:items-center lg:justify-between lg:py-0">
          <div className="flex w-full items-center justify-between gap-3 lg:hidden">
            <Link href="/" className="truncate text-sm font-bold text-slate-900">
              Letáky <span className="text-indigo-600">Admin</span>
            </Link>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Upozornění"
              >
                🔔
              </button>
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 ring-2 ring-white shadow-md" />
            </div>
          </div>
          <nav className="flex flex-wrap gap-1.5 pb-1 text-xs font-medium lg:hidden">
            <Link href="/batches" className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
              Dávky
            </Link>
            <Link href="/quarantine" className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
              Karanténa
            </Link>
            <Link href="/upload" className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
              Nahrát
            </Link>
            <Link href="/review" className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
              Ke kontrole
            </Link>
            <Link href="/history" className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
              Historie
            </Link>
            <Link href="/image-generation-requests" className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
              Požadavky na obrázky
            </Link>
            <Link href="/parsers" className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
              Parsery
            </Link>
            <Link href="/settings" className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
              Nastavení
            </Link>
          </nav>
          <div className="ml-auto hidden items-center gap-1 lg:flex">
            <button
              type="button"
              className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              aria-label="Upozornění"
            >
              🔔
            </button>
            <div
              className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 ring-2 ring-white shadow-md"
              title="Účet"
            />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>

        <footer className="border-t border-slate-200 bg-white py-5 text-center text-xs text-slate-400">
          Letáky Admin · OCR &amp; vision · Supabase dávky
        </footer>
      </div>
    </div>
  );
}
