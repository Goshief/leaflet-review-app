"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { computeRowCounts, type RowReviewStatus } from "@/components/review/product-cards";
import { useToasts } from "@/components/ui/toasts";

type CommitLogEntry = {
  id: string;
  committed_at: string;
  actor: string | null;
  retailer: string | null;
  source_url: string | null;
  original_filename: string | null;
  page_no: number | null;
  counts: {
    staging: number;
    approved: number;
    rejected: number;
    quarantined: number;
    pending: number;
  };
  batch_id?: string | null;
  import_id?: string | null;
  session_key?: string | null;
  import_status?: "ok" | "error" | string | null;
  http_status?: number | null;
  db_error?: string | null;
  target_tables?: string[] | null;
  exported_items?: any[] | null;
};

type ReviewStateEntry = {
  offers?: any[]; // legacy
  rowStatus?: Record<number, RowReviewStatus | undefined>; // legacy
  offersByPage?: Record<string, any[]>;
  rowStatusByPage?: Record<string, Record<number, RowReviewStatus | undefined>>;
  updated_at?: string;
  resume_url?: string | null;
  // audit-ish metadata (uložené z /review)
  sourceUrl?: string;
  extractMode?: string;
  model?: string;
  actorName?: string;
  pageNo?: number;
  retailer?: string;
};

function parseNameFromResumeUrl(resumeUrl: string | null | undefined): string | null {
  const u = (resumeUrl ?? "").toString().trim();
  if (!u) return null;
  try {
    const qs = u.includes("?") ? u.slice(u.indexOf("?") + 1) : "";
    const p = new URLSearchParams(qs);
    const name = (p.get("name") ?? "").trim();
    return name || null;
  } catch {
    return null;
  }
}

function deriveRetailerFromState(state: ReviewStateEntry): string {
  const explicit = (state.retailer ?? "").toString().trim().toLowerCase();
  if (explicit) return explicit;
  try {
    const sample =
      state.offersByPage && typeof state.offersByPage === "object"
        ? Object.values(state.offersByPage)?.[0]?.[0]
        : Array.isArray(state.offers)
          ? state.offers?.[0]
          : null;
    const v = (sample?.store_id ?? sample?.source_type ?? "").toString().trim().toLowerCase();
    return v || "—";
  } catch {
    return "—";
  }
}

function safeParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export default function HistoryPage() {
  const toast = useToasts();
  const [items, setItems] = useState<CommitLogEntry[]>([]);
  const [sessions, setSessions] = useState<Array<{ key: string; state: ReviewStateEntry }>>(
    []
  );
  const [q, setQ] = useState("");
  const [filterRetailer, setFilterRetailer] = useState<string>("all");
  const [filterActor, setFilterActor] = useState<string>("all");
  const [filterDate, setFilterDate] = useState<string>("all"); // YYYY-MM-DD
  const [filterStatus, setFilterStatus] = useState<RowReviewStatus | "all">("all");

  useEffect(() => {
    const refresh = () => {
      const parsed = safeParse<CommitLogEntry[]>(
        localStorage.getItem("leaflet_commit_log")
      );
      setItems(Array.isArray(parsed) ? parsed : []);

      try {
        const out: Array<{ key: string; state: ReviewStateEntry }> = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i) ?? "";
          if (!k.startsWith("leaflet_review_state:")) continue;
          const raw = localStorage.getItem(k);
          const st = safeParse<ReviewStateEntry>(raw);
          const legacyOk = st && Array.isArray(st.offers);
          const byPageOk = st && st.offersByPage && typeof st.offersByPage === "object";
          if (legacyOk || byPageOk) out.push({ key: k, state: st! });
        }
        out.sort((a, b) =>
          String(b.state.updated_at ?? "").localeCompare(String(a.state.updated_at ?? ""))
        );
        setSessions(out.slice(0, 30));
      } catch {
        setSessions([]);
      }
    };

    refresh();
    const t = window.setInterval(refresh, 1000);
    return () => window.clearInterval(t);
  }, []);

  const sorted = useMemo(() => {
    return items
      .slice()
      .sort((a, b) => (b.committed_at || "").localeCompare(a.committed_at || ""));
  }, [items]);

  const filteredCommits = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return sorted.filter((x) => {
      if (filterRetailer !== "all" && (x.retailer ?? "").toLowerCase() !== filterRetailer) return false;
      if (filterActor !== "all" && (x.actor ?? "").toLowerCase() !== filterActor) return false;
      if (filterDate !== "all") {
        const d = String(x.committed_at ?? "").slice(0, 10);
        if (d !== filterDate) return false;
      }
      if (filterStatus !== "all") {
        const c = x.counts ?? ({} as any);
        const map: Record<string, number> = {
          approved: c.approved ?? 0,
          rejected: c.rejected ?? 0,
          quarantine: c.quarantined ?? 0,
          pending: c.pending ?? 0,
        };
        if ((map[filterStatus] ?? 0) <= 0) return false;
      }
      if (qq) {
        const hay = [
          x.retailer ?? "",
          x.actor ?? "",
          x.original_filename ?? "",
          x.source_url ?? "",
          x.batch_id ?? "",
          x.import_id ?? "",
          x.session_key ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [sorted, q, filterRetailer, filterActor, filterDate, filterStatus]);

  const retailerOptions = useMemo(() => {
    const s = new Set<string>();
    for (const x of sorted) {
      const r = (x.retailer ?? "").toString().trim().toLowerCase();
      if (r) s.add(r);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, "cs"));
  }, [sorted]);

  const actorOptions = useMemo(() => {
    const s = new Set<string>();
    for (const x of sorted) {
      const a = (x.actor ?? "").toString().trim().toLowerCase();
      if (a) s.add(a);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, "cs"));
  }, [sorted]);

  const dateOptions = useMemo(() => {
    const s = new Set<string>();
    for (const x of sorted) {
      const d = String(x.committed_at ?? "").slice(0, 10);
      if (d && d.includes("-")) s.add(d);
    }
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [sorted]);

  const confirmClear = () =>
    window.confirm("Opravdu smazat historii? Tato akce nejde vrátit.");

  const clearReviewSessions = () => {
    if (!confirmClear()) return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? "";
        if (k.startsWith("leaflet_review_state:")) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore
    }
    // Best-effort: pokud by někde byly session data i v IndexedDB.
    try {
      if (typeof indexedDB !== "undefined") {
        indexedDB.deleteDatabase("keyval-store");
      }
    } catch {
      // ignore
    }
    setSessions([]);
    toast.success("Historie smazána", "Rozpracované kontroly byly odstraněny.");
  };

  const clearCommitHistory = () => {
    if (!confirmClear()) return;
    try {
      localStorage.removeItem("leaflet_commit_log");
    } catch {
      // ignore
    }
    // Best-effort: pokud by commit log někde byl i v IndexedDB.
    try {
      if (typeof indexedDB !== "undefined") {
        indexedDB.deleteDatabase("keyval-store");
      }
    } catch {
      // ignore
    }
    setItems([]);
    toast.success("Historie smazána", "Lokální historie commitů byla odstraněna.");
  };

  return (
    <main className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Historie
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Rozpracované kontroly (lokálně) + commit historie (lokálně). Funguje i bez Supabase.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/batches"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
          >
            Otevřít dávky (Supabase) →
          </Link>
          <button
            type="button"
            onClick={clearReviewSessions}
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800 shadow-sm transition hover:bg-rose-100"
          >
            Vymazat rozpracované kontroly
          </button>
          <button
            type="button"
            onClick={clearCommitHistory}
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800 shadow-sm transition hover:bg-rose-100"
          >
            Vymazat lokální historii commitů
          </button>
        </div>
      </div>

      {sessions.length ? (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Rozpracované kontroly</h2>
              <p className="mt-1 text-sm text-slate-600">
                Auditní přehled lokálních session stavů (`leaflet_review_state:*`).
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {sessions.map(({ key, state }) => {
              const internalKey = key.startsWith("leaflet_review_state:")
                ? key.slice("leaflet_review_state:".length)
                : key;
              const pages =
                state.offersByPage && typeof state.offersByPage === "object"
                  ? Object.values(state.offersByPage)
                  : [];
              const offersLen =
                pages.length > 0
                  ? pages.reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0)
                  : Array.isArray(state.offers)
                    ? state.offers.length
                    : 0;

              let c = { approved: 0, rejected: 0, quarantined: 0, pending: 0 };
              if (pages.length > 0) {
                for (const [pStr, arr] of Object.entries(state.offersByPage ?? {})) {
                  const st = (state.rowStatusByPage ?? {})[pStr] ?? {};
                  const indices = Array.from(
                    { length: Array.isArray(arr) ? arr.length : 0 },
                    (_, i) => i
                  );
                  const migrated = Object.fromEntries(
                    Object.entries(st as Record<string, unknown>).map(([k, v]) => [
                      k,
                      v === "quarantined" ? "quarantine" : v,
                    ])
                  ) as any;
                  const cc = computeRowCounts(indices, migrated);
                  c = {
                    approved: c.approved + cc.approved,
                    rejected: c.rejected + cc.rejected,
                    quarantined: c.quarantined + cc.quarantined,
                    pending: c.pending + cc.pending,
                  };
                }
              } else {
                const indices = Array.from({ length: offersLen }, (_, i) => i);
                const migrated = Object.fromEntries(
                  Object.entries((state.rowStatus ?? {}) as Record<string, unknown>).map(
                    ([k, v]) => [k, v === "quarantined" ? "quarantine" : v]
                  )
                ) as any;
                c = computeRowCounts(indices, migrated);
              }
              const resume = (state.resume_url ?? "").toString().trim();
              const baseHref = resume.startsWith("/review") ? resume : "/review";
              const href = baseHref.includes("?")
                ? `${baseHref}&resume_key=${encodeURIComponent(internalKey)}`
                : `${baseHref}?resume_key=${encodeURIComponent(internalKey)}`;
              const retailer = deriveRetailerFromState(state);
              const operator = (state.actorName ?? "").toString().trim() || null;
              const sourceUrl = (state.sourceUrl ?? "").toString().trim() || null;
              const sourceName = parseNameFromResumeUrl(state.resume_url) || null;
              return (
                <article
                  key={key}
                  className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-[0_8px_40px_rgba(15,23,42,0.06)] ring-1 ring-slate-100"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        Kontrola ({offersLen} položek)
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        Session: <span className="font-mono">{internalKey}</span>
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
                      {state.updated_at
                        ? new Date(state.updated_at).toLocaleString("cs-CZ")
                        : "—"}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-800 ring-1 ring-emerald-200/70">
                      ✓ {c.approved} schváleno
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700 ring-1 ring-slate-200">
                      ✕ {c.rejected} zamítnuto
                    </span>
                    <span className="rounded-full bg-indigo-50 px-2 py-1 font-medium text-indigo-800 ring-1 ring-indigo-200/70">
                      🗂 {c.quarantined} karanténa
                    </span>
                    <span className="rounded-full bg-amber-50 px-2 py-1 font-medium text-amber-900 ring-1 ring-amber-200/70">
                      ⏳ {c.pending} čeká
                    </span>
                  </div>

                  <div className="mt-4 space-y-1 text-xs text-slate-600">
                    <p>
                      Obchod: <strong className="capitalize text-slate-800">{retailer}</strong>
                    </p>
                    <p>
                      Operátor: <strong className="text-slate-800">{operator ?? "—"}</strong>
                    </p>
                    <p className="truncate">
                      Zdroj:{" "}
                      <strong className="text-slate-800">
                        {sourceName ?? (internalKey.startsWith("intake:") ? "PDF/obrázek (intake)" : internalKey.startsWith("manual:") ? "Excel/CSV (manual)" : "—")}
                      </strong>
                      {sourceUrl ? (
                        <>
                          {" "}
                          ·{" "}
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-indigo-700 hover:underline"
                          >
                            odkaz →
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>

                  <div className="mt-4">
                    <Link
                      href={href}
                      className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:bg-indigo-700"
                    >
                      Pokračovat →
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Commity do DB</h2>
            <p className="mt-1 text-sm text-slate-600">
              Audit exportů do Supabase: zapisuje se do <code className="text-slate-800">imports</code> a <code className="text-slate-800">offers_raw</code>.
            </p>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <div className="grid gap-3 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-5">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Hledat (soubor / batch / session / operátor)
              </label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="např. lidl, Klára, import id…"
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Status
              </label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Vše</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
                <option value="quarantine">quarantine</option>
                <option value="pending">pending</option>
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Obchod
              </label>
              <select
                value={filterRetailer}
                onChange={(e) => setFilterRetailer(e.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Vše</option>
                {retailerOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Operátor
              </label>
              <select
                value={filterActor}
                onChange={(e) => setFilterActor(e.target.value)}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Všichni</option>
                {actorOptions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-2 text-slate-700">
              <span className="font-semibold">Datum</span>
              <select
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">Vše</option>
                {dateOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setQ("");
                setFilterRetailer("all");
                setFilterActor("all");
                setFilterDate("all");
                setFilterStatus("all");
              }}
              className="text-xs font-semibold text-slate-600 hover:underline"
            >
              Reset filtrů
            </button>
            <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700 ring-1 ring-slate-200">
              Zobrazeno: {filteredCommits.length} / {sorted.length}
            </span>
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-[0_4px_24px_rgba(15,23,42,0.04)]">
            <p className="text-slate-900 font-semibold">
              Zatím tu nejsou žádné commity. Vzniknou po odeslání schválených položek do databáze.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Začni na kontrole letáku a klikni na <strong>„Odeslat schválené do databáze“</strong>.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {filteredCommits.map((x) => {
              const batchOrImportId = x.import_id ?? x.batch_id ?? null;
              return (
                <article
                  key={x.id}
                  className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-[0_8px_40px_rgba(15,23,42,0.06)] ring-1 ring-slate-100"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {x.retailer ?? "—"} · export
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {x.original_filename ?? x.source_url ?? "—"}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
                      {new Date(x.committed_at).toLocaleString("cs-CZ")}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-800 ring-1 ring-emerald-200/70">
                      ✓ {x.counts.approved} exportováno (approved)
                    </span>
                    {x.actor ? (
                      <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700 ring-1 ring-slate-200">
                        Operátor: {x.actor}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-slate-500">
                    {batchOrImportId ? (
                      <p>
                        Batch/Import ID:{" "}
                        <strong className="text-slate-700">{batchOrImportId}</strong>
                      </p>
                    ) : null}
                    {x.session_key ? (
                      <p>
                        Session: <strong className="text-slate-700">{x.session_key}</strong>
                      </p>
                    ) : null}
                    <p>
                      Kam:{" "}
                      <strong className="text-slate-700">
                        imports (audit) + offers_raw (finální tabulka)
                      </strong>
                    </p>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {x.batch_id ? (
                      <Link
                        href={`/batches/${x.batch_id}`}
                        className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:bg-indigo-700"
                      >
                        Otevřít batch →
                      </Link>
                    ) : null}
                    {x.source_url ? (
                      <a
                        href={x.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-semibold text-indigo-700 hover:underline"
                      >
                        Otevřít odkaz →
                      </a>
                    ) : null}
                  </div>

                  <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm">
                    <summary className="cursor-pointer font-semibold text-slate-700">
                      Detail commitu
                    </summary>
                    <div className="mt-2 space-y-2 text-xs text-slate-700">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-white px-2 py-1 ring-1 ring-slate-200">
                          Stav importu:{" "}
                          <strong>{(x.import_status ?? "ok").toString()}</strong>
                        </span>
                        {x.http_status != null ? (
                          <span className="rounded-full bg-white px-2 py-1 ring-1 ring-slate-200">
                            HTTP: <strong>{x.http_status}</strong>
                          </span>
                        ) : null}
                        {x.target_tables?.length ? (
                          <span className="rounded-full bg-white px-2 py-1 ring-1 ring-slate-200">
                            Kam: <strong>{x.target_tables.join(", ")}</strong>
                          </span>
                        ) : null}
                      </div>
                      {x.db_error ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900">
                          DB chyba: {x.db_error}
                        </div>
                      ) : null}
                      {Array.isArray(x.exported_items) && x.exported_items.length ? (
                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                          <p className="font-semibold text-slate-800">
                            Exportované položky ({x.exported_items.length})
                          </p>
                          <ul className="mt-2 max-h-40 overflow-auto space-y-1 text-slate-700">
                            {x.exported_items.slice(0, 200).map((o: any, idx: number) => (
                              <li key={idx} className="flex flex-wrap items-center justify-between gap-2">
                                <span className="min-w-0 truncate">
                                  <strong>{(o?.extracted_name ?? "—").toString()}</strong>
                                  {o?.page_no != null ? (
                                    <span className="text-slate-500"> · str. {o.page_no}</span>
                                  ) : null}
                                </span>
                                <span className="shrink-0 tabular-nums text-slate-600">
                                  {o?.price_total != null ? `${o.price_total} ${o?.currency ?? "CZK"}` : "—"}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {x.exported_items.length > 200 ? (
                            <p className="mt-2 text-[11px] text-slate-500">
                              Zobrazuju prvních 200 (kvůli výkonu).
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-600">
{JSON.stringify(
  {
    id: x.id,
    committed_at: x.committed_at,
    actor: x.actor,
    retailer: x.retailer,
    original_filename: x.original_filename,
    source_url: x.source_url,
    import_id: x.import_id,
    batch_id: x.batch_id,
    session_key: x.session_key,
    counts: x.counts,
    import_status: x.import_status ?? null,
    http_status: x.http_status ?? null,
    db_error: x.db_error ?? null,
    target_tables: x.target_tables ?? null,
    exported_items: Array.isArray(x.exported_items) ? x.exported_items.slice(0, 50) : null,
  },
  null,
  2
)}
                    </pre>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

