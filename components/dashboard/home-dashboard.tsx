"use client";

import Link from "next/link";
import { computeRowCounts, type RowReviewStatus } from "@/components/review/product-cards";
import { useEffect, useMemo, useState } from "react";
import { reviewQuarantineHref } from "@/lib/nav/quarantine";
import type {
  ActivityItem,
  DashboardAlert,
  DashboardKpis,
  DashboardTrendPoint,
  ProblemBatchRow,
  QuarantineReasonRow,
  RetailerBreakdownRow,
  RetailerDominanceRow,
} from "@/lib/dashboard/get-dashboard";

function fmtInt(n: number) {
  return n.toLocaleString("cs");
}

type CommitLogEntry = {
  id?: string;
  committed_at?: string;
  actor?: string | null;
  retailer?: string | null;
  original_filename?: string | null;
  source_url?: string | null;
  batch_id?: string | null;
  import_id?: string | null;
  session_key?: string | null;
  counts?: {
    staging?: number;
    approved?: number;
    rejected?: number;
    quarantined?: number;
    pending?: number;
  };
};

type ReviewStateEntry = {
  offers?: any[]; // legacy
  rowStatus?: Record<number, RowReviewStatus | undefined>; // legacy
  offersByPage?: Record<string, any[]>;
  rowStatusByPage?: Record<string, Record<number, RowReviewStatus | undefined>>;
  updated_at?: string;
  resume_url?: string | null;
};

type LastReview = {
  session_key: string;
  page_no?: number | null;
  href?: string | null;
  updated_at?: string | null;
  file_name?: string | null;
};

type LastBatch = {
  import_id: string;
  at?: string | null;
};

function safeParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function continueReviewHref(sessionKey: string | null | undefined): string {
  const p = new URLSearchParams();
  p.set("tab", "pending");
  p.set("filter", "pending");
  if (sessionKey) p.set("resume_key", sessionKey);
  return `/review?${p.toString()}`;
}

function sessionCounts(state: ReviewStateEntry) {
  const pages =
    state.offersByPage && typeof state.offersByPage === "object"
      ? Object.entries(state.offersByPage)
      : [];
  const legacyOffers = Array.isArray(state.offers) ? state.offers : null;

  let c = { approved: 0, rejected: 0, quarantined: 0, pending: 0 };
  if (pages.length) {
    for (const [pStr, arr] of pages) {
      const st = (state.rowStatusByPage ?? {})[pStr] ?? {};
      const indices = Array.from({ length: Array.isArray(arr) ? arr.length : 0 }, (_, i) => i);
      const migrated = Object.fromEntries(
        Object.entries(st as Record<string, unknown>).map(([k, v]) => [k, v === "quarantined" ? "quarantine" : v])
      ) as any;
      const cc = computeRowCounts(indices, migrated);
      c = {
        approved: c.approved + cc.approved,
        rejected: c.rejected + cc.rejected,
        quarantined: c.quarantined + cc.quarantined,
        pending: c.pending + cc.pending,
      };
    }
    return c;
  }

  const offersLen = legacyOffers?.length ?? 0;
  const indices = Array.from({ length: offersLen }, (_, i) => i);
  const migrated = Object.fromEntries(
    Object.entries((state.rowStatus ?? {}) as Record<string, unknown>).map(([k, v]) => [k, v === "quarantined" ? "quarantine" : v])
  ) as any;
  return computeRowCounts(indices, migrated);
}

function kpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: "blue" | "green" | "orange" | "red" | "gray" | "purple";
}) {
  const accentClass =
    accent === "green"
      ? "ring-emerald-200/70 text-emerald-700"
      : accent === "orange"
        ? "ring-amber-200/70 text-amber-700"
        : accent === "red"
          ? "ring-rose-200/70 text-rose-700"
          : accent === "purple"
            ? "ring-violet-200/70 text-violet-700"
            : accent === "blue"
              ? "ring-indigo-200/70 text-indigo-700"
              : "ring-slate-200 text-slate-600";

  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">
        {value}
      </p>
      <p className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${accentClass}`}>
        {sub}
      </p>
    </div>
  );
}

function stackedBar(p: DashboardTrendPoint) {
  const total = p.inserted || 1;
  const approved = (p.approved / total) * 100;
  const quarantined = (p.quarantined / total) * 100;
  const rejected = (p.rejected / total) * 100;
  const pending = Math.max(0, 100 - approved - quarantined - rejected);
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
      <div className="flex h-full w-full">
        <div className="h-full bg-emerald-500" style={{ width: `${approved}%` }} />
        <div className="h-full bg-amber-400" style={{ width: `${quarantined}%` }} />
        <div className="h-full bg-rose-500" style={{ width: `${rejected}%` }} />
        <div className="h-full bg-slate-300" style={{ width: `${pending}%` }} />
      </div>
    </div>
  );
}

function ActivityDot({ kind }: { kind: ActivityItem["kind"] }) {
  const cls =
    kind === "ok"
      ? "bg-emerald-500"
      : kind === "warn"
        ? "bg-amber-400"
        : kind === "error"
          ? "bg-rose-500"
          : "bg-slate-400";
  return <span className={`mt-1 inline-block h-2.5 w-2.5 rounded-full ${cls}`} />;
}

export function HomeDashboard({
  configured,
  showDemoBadge,
  hot_now,
  alerts,
  today,
  trend_7d,
  trend_30d,
  dominance_inserted,
  dominance_approved,
  dominance_quarantined,
  quality_by_retailer,
  quarantine_reasons,
  problem_batches,
  activity,
}: {
  configured: boolean;
  showDemoBadge?: boolean;
  hot_now: {
    batches_waiting_review: number;
    open_alerts: number;
    imports_error: number;
    batches_quarantine: number;
  };
  alerts: DashboardAlert[];
  today: DashboardKpis;
  trend_7d: DashboardTrendPoint[];
  trend_30d: DashboardTrendPoint[];
  dominance_inserted: RetailerDominanceRow[];
  dominance_approved: RetailerDominanceRow[];
  dominance_quarantined: RetailerDominanceRow[];
  quality_by_retailer: RetailerBreakdownRow[];
  quarantine_reasons: QuarantineReasonRow[];
  problem_batches: ProblemBatchRow[];
  activity: ActivityItem[];
}) {
  const [trendTab, setTrendTab] = useState<"today" | "7d" | "30d">("7d");
  const [dominanceMetric, setDominanceMetric] = useState<
    "inserted" | "approved" | "quarantined"
  >("inserted");

  const [recentSessions, setRecentSessions] = useState<Array<{ key: string; state: ReviewStateEntry }>>([]);
  const [recentCommits, setRecentCommits] = useState<CommitLogEntry[]>([]);
  const [lastReview, setLastReview] = useState<LastReview | null>(null);
  const [lastBatch, setLastBatch] = useState<LastBatch | null>(null);

  useEffect(() => {
    const refresh = () => {
      // Rozpracované kontroly.
      try {
        const out: Array<{ key: string; state: ReviewStateEntry }> = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i) ?? "";
          if (!k.startsWith("leaflet_review_state:")) continue;
          const st = safeParse<ReviewStateEntry>(localStorage.getItem(k));
          const legacyOk = st && Array.isArray(st.offers);
          const byPageOk = st && st.offersByPage && typeof st.offersByPage === "object";
          if (legacyOk || byPageOk) out.push({ key: k, state: st! });
        }
        out.sort((a, b) => String(b.state.updated_at ?? "").localeCompare(String(a.state.updated_at ?? "")));
        setRecentSessions(out.slice(0, 6));
      } catch {
        setRecentSessions([]);
      }

      // Commity.
      try {
        const parsed = safeParse<CommitLogEntry[]>(localStorage.getItem("leaflet_commit_log"));
        const arr = Array.isArray(parsed) ? parsed : [];
        const sorted = arr
          .slice()
          .sort((a, b) => String(b.committed_at ?? "").localeCompare(String(a.committed_at ?? "")));
        setRecentCommits(sorted.slice(0, 6));
      } catch {
        setRecentCommits([]);
      }

      // Poslední kontrola / poslední dávka.
      try {
        const lr = safeParse<LastReview>(localStorage.getItem("leaflet_last_review"));
        setLastReview(lr && typeof lr.session_key === "string" ? lr : null);
      } catch {
        setLastReview(null);
      }
      try {
        const lb = safeParse<LastBatch>(localStorage.getItem("leaflet_last_batch"));
        setLastBatch(lb && typeof lb.import_id === "string" ? lb : null);
      } catch {
        setLastBatch(null);
      }
    };

    refresh();
    const t = window.setInterval(refresh, 2000);
    return () => window.clearInterval(t);
  }, []);

  const continueHref = useMemo(() => {
    if (lastReview?.session_key) {
      return continueReviewHref(lastReview.session_key);
    }
    const top = recentSessions[0];
    if (!top) return continueReviewHref(null);
    const internalKey = top.key.startsWith("leaflet_review_state:")
      ? top.key.slice("leaflet_review_state:".length)
      : top.key;
    return continueReviewHref(internalKey);
  }, [recentSessions, lastReview]);

  const lastReviewPage = lastReview?.page_no ?? null;
  const lastBatchHref = lastBatch?.import_id ? `/batches/${encodeURIComponent(lastBatch.import_id)}` : null;

  const trend = trendTab === "30d" ? trend_30d : trend_7d;
  const dominance = useMemo(() => {
    return dominanceMetric === "approved"
      ? dominance_approved
      : dominanceMetric === "quarantined"
        ? dominance_quarantined
        : dominance_inserted;
  }, [dominanceMetric, dominance_approved, dominance_inserted, dominance_quarantined]);

  const heroLine = useMemo(() => {
    const inserted = fmtInt(today.inserted);
    const pending = fmtInt(today.pending);
    const quarantined = fmtInt(today.quarantined);
    return `Dnes zpracováno ${inserted} produktů · ${pending} čeká na kontrolu · ${quarantined} v karanténě`;
  }, [today]);

  const approvalRate = today.approval_rate_pct;

  return (
    <main className="mx-auto max-w-7xl space-y-8">
      {/* HERO */}
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
        <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-900 px-8 py-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
                Přehled zpracování letáků
              </h1>
              <p className="mt-2 text-sm text-white/80">{heroLine}</p>
              {lastReview?.session_key ? (
                <p className="mt-2 text-xs text-white/70">
                  Poslední kontrola:{" "}
                  <span className="font-semibold text-white/85">
                    {lastReview.file_name ?? "—"}
                  </span>
                  {lastReviewPage != null ? (
                    <span> · stránka {lastReviewPage}</span>
                  ) : null}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={continueHref}
                className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
              >
                🟣 Pokračovat v kontrole ▶
              </Link>
              {lastBatchHref ? (
                <Link
                  href={lastBatchHref}
                  className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
                >
                  🧾 Poslední dávka →
                </Link>
              ) : null}
              <Link
                href={reviewQuarantineHref()}
                className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
              >
                🗂 Otevřít karanténu
              </Link>
              <Link
                href="/upload"
                className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 hover:from-indigo-500 hover:to-violet-500"
              >
                + Nahrát leták
              </Link>
            </div>
          </div>
        </div>

        {/* Alert strip */}
        <div className="border-t border-slate-200 bg-white px-6 py-3">
          <div className="flex flex-wrap gap-2">
            {alerts.length ? (
              alerts.map((a, idx) => {
                const cls =
                  a.kind === "error"
                    ? "bg-rose-50 text-rose-900 ring-rose-200/80"
                    : a.kind === "warning"
                      ? "bg-amber-50 text-amber-950 ring-amber-200/80"
                      : "bg-slate-50 text-slate-800 ring-slate-200/80";
                const inner = (
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${cls}`}
                  >
                    {a.text}
                  </span>
                );
                return a.href ? (
                  <Link key={idx} href={a.href} className="hover:opacity-90">
                    {inner}
                  </Link>
                ) : (
                  <span key={idx}>{inner}</span>
                );
              })
            ) : (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-200/80">
                Všechno v normě
              </span>
            )}
            {!configured && showDemoBadge !== false ? (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                Demo režim (Supabase není nakonfigurované)
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {/* PRÁCE (rozcestník) */}
      <section className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
          <div className="border-b border-slate-200 bg-white px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">Poslední rozpracované kontroly</h2>
            <p className="mt-1 text-sm text-slate-600">Rychlý návrat do rozdělané práce.</p>
          </div>
          <div className="px-6 py-5 space-y-3">
            {recentSessions.length ? (
              recentSessions.map(({ key, state }) => {
                const internalKey = key.startsWith("leaflet_review_state:")
                  ? key.slice("leaflet_review_state:".length)
                  : key;
                const c = sessionCounts(state);
                const href = continueReviewHref(internalKey);
                return (
                  <div key={key} className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">Kontrola</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {state.updated_at ? new Date(state.updated_at).toLocaleString("cs-CZ") : "—"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-800 ring-1 ring-emerald-200/70">
                            ✓ {fmtInt(c.approved)}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700 ring-1 ring-slate-200">
                            ✕ {fmtInt(c.rejected)}
                          </span>
                          <span className="rounded-full bg-indigo-50 px-2 py-1 font-semibold text-indigo-800 ring-1 ring-indigo-200/70">
                            🗂 {fmtInt(c.quarantined)}
                          </span>
                          <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-900 ring-1 ring-amber-200/70">
                            ⏳ {fmtInt(c.pending)}
                          </span>
                        </div>
                      </div>
                      <Link
                        href={href}
                        className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 hover:bg-indigo-700"
                      >
                        Pokračovat →
                      </Link>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-slate-500">Zatím žádné rozpracované kontroly.</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
          <div className="border-b border-slate-200 bg-white px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">Poslední commity</h2>
            <p className="mt-1 text-sm text-slate-600">Co se naposledy odeslalo do DB.</p>
          </div>
          <div className="px-6 py-5 space-y-3">
            {recentCommits.length ? (
              recentCommits.map((x, idx) => {
                const approved = x.counts?.approved ?? 0;
                const when = x.committed_at ? new Date(x.committed_at).toLocaleString("cs-CZ") : "—";
                const id = x.import_id ?? x.batch_id ?? null;
                return (
                  <div key={x.id ?? String(idx)} className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">
                          ✓ {fmtInt(approved)} approved · {x.retailer ?? "—"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{when}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Operátor: <span className="font-semibold text-slate-700">{x.actor ?? "—"}</span>
                        </p>
                        {id ? (
                          <p className="mt-1 text-xs text-slate-500">
                            Batch/Import: <span className="font-semibold text-slate-700">{id}</span>
                          </p>
                        ) : null}
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {x.original_filename ?? x.source_url ?? "—"}
                        </p>
                      </div>
                      <Link
                        href="/history"
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                      >
                        Historie →
                      </Link>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-[0_4px_24px_rgba(15,23,42,0.04)]">
                <p className="text-slate-900 font-semibold">
                  Zatím tu nejsou žádné commity. Vzniknou po odeslání schválených položek do databáze.
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Začni na kontrole letáku a klikni na <strong>„Odeslat schválené do databáze“</strong>.
                </p>
                <div className="mt-5 flex justify-center gap-2">
                  <Link
                    href="/review"
                    className="inline-flex items-center justify-center rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 hover:bg-indigo-700"
                  >
                    Otevřít kontrolu →
                  </Link>
                  <Link
                    href="/upload"
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                  >
                    + Nahrát leták
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* KPI STRIP */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {kpiCard({
          label: "Vložené produkty",
          value: fmtInt(today.inserted),
          sub: "Za dnešek",
          accent: "blue",
        })}
        {kpiCard({
          label: "Schválené",
          value: fmtInt(today.approved),
          sub: "Odesláno do databáze",
          accent: "green",
        })}
        {kpiCard({
          label: "Čeká na kontrolu",
          value: fmtInt(today.pending),
          sub: "Rozpracované",
          accent: "orange",
        })}
        {kpiCard({
          label: "Karanténa",
          value: fmtInt(today.quarantined),
          sub: "Vyžaduje zásah",
          accent: "red",
        })}
        {kpiCard({
          label: "Zamítnuté",
          value: fmtInt(today.rejected),
          sub: "Špatná extrakce",
          accent: "gray",
        })}
        {kpiCard({
          label: "Úspěšnost",
          value: approvalRate == null ? "—" : `${String(approvalRate).replace(".", ",")} %`,
          sub: "Schválené z vložených",
          accent: "purple",
        })}
      </section>

      {/* ROW 2 */}
      <section className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
          <div className="border-b border-slate-200 bg-white px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Zpracování produktů
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Posledních {trendTab === "30d" ? "30" : "7"} dní (stacked: schválené/karanténa/zamítnuté/čeká).
                </p>
              </div>
              <div className="flex gap-1 rounded-2xl bg-slate-50 p-1 ring-1 ring-slate-200">
                {[
                  { id: "7d", label: "7 dní" },
                  { id: "30d", label: "30 dní" },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTrendTab(t.id as any)}
                    className={
                      trendTab === t.id
                        ? "rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                        : "rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"
                    }
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="px-6 py-5">
            <div className="space-y-3">
              {trend.slice(-14).map((p) => (
                <div key={p.date} className="grid grid-cols-[88px_1fr_72px] items-center gap-3">
                  <span className="text-xs font-medium text-slate-500">{p.date.slice(5)}</span>
                  {stackedBar(p)}
                  <span className="text-xs font-semibold tabular-nums text-slate-700">
                    {fmtInt(p.inserted)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Schválené
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">
                <span className="h-2 w-2 rounded-full bg-amber-400" /> Karanténa
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">
                <span className="h-2 w-2 rounded-full bg-rose-500" /> Zamítnuté
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 ring-1 ring-slate-200">
                <span className="h-2 w-2 rounded-full bg-slate-300" /> Čeká
              </span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
          <div className="border-b border-slate-200 bg-white px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">
              Nejaktivnější obchody
            </h2>
            <div className="mt-3 flex gap-1 rounded-2xl bg-slate-50 p-1 ring-1 ring-slate-200">
              {[
                { id: "inserted", label: "vložené" },
                { id: "approved", label: "schválené" },
                { id: "quarantined", label: "karanténa" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDominanceMetric(t.id as any)}
                  className={
                    dominanceMetric === t.id
                      ? "rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                      : "rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="px-6 py-5">
            {dominance.length === 0 ? (
              <p className="text-sm text-slate-500">Zatím žádná data.</p>
            ) : (
              <div className="space-y-3">
                {dominance.map((r) => {
                  const max = dominance[0]?.value || 1;
                  const w = Math.max(6, Math.round((r.value / max) * 100));
                  return (
                    <div key={r.retailer} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold capitalize text-slate-900">
                          {r.retailer}
                        </span>
                        <span className="tabular-nums text-slate-700">{fmtInt(r.value)}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 ring-1 ring-slate-200">
                        <div
                          className="h-2 rounded-full bg-indigo-600"
                          style={{ width: `${w}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ROW 3 */}
      <section className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
          <div className="border-b border-slate-200 bg-white px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">
              Kvalita podle obchodů
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Objem i problémovost na jednom místě.
            </p>
          </div>
          <div className="overflow-x-auto px-6 py-5">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4">Obchod</th>
                  <th className="py-2 pr-4">Vložené</th>
                  <th className="py-2 pr-4">Schválené</th>
                  <th className="py-2 pr-4">Karanténa</th>
                  <th className="py-2 pr-4">Zamítnuté</th>
                  <th className="py-2 pr-0">Úspěšnost</th>
                </tr>
              </thead>
              <tbody>
                {quality_by_retailer.slice(0, 10).map((r) => (
                  <tr
                    key={r.retailer}
                    className="border-t border-slate-100 hover:bg-slate-50/60"
                  >
                    <td className="py-2 pr-4 font-semibold capitalize text-slate-900">
                      {r.retailer}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-slate-700">
                      {fmtInt(r.inserted)}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-emerald-700">
                      {fmtInt(r.approved)}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-amber-700">
                      {fmtInt(r.quarantined)}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-rose-700">
                      {fmtInt(r.rejected)}
                    </td>
                    <td className="py-2 pr-0 tabular-nums text-slate-700">
                      {r.success_pct == null
                        ? "—"
                        : `${String(r.success_pct).replace(".", ",")} %`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 overflow-hidden rounded-3xl border border-rose-200 bg-gradient-to-b from-rose-50 to-amber-50 shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-rose-100">
          <div className="border-b border-rose-200/70 px-6 py-5">
            <h2 className="text-lg font-semibold text-rose-900">
              Produkty v karanténě
            </h2>
            <p className="mt-1 text-sm text-rose-900/70">
              Vyžaduje ruční zásah
            </p>
          </div>
          <div className="px-6 py-5">
            <p className="text-4xl font-semibold tabular-nums text-rose-900">
              {fmtInt(today.quarantined)}
            </p>
            <p className="mt-1 text-sm text-rose-900/70">v karanténě dnes</p>

            <div className="mt-4 space-y-2">
              {quarantine_reasons.slice(0, 6).map((r) => (
                <div key={r.reason} className="flex items-center justify-between text-sm">
                  <span className="text-rose-900/80">{r.reason}</span>
                  <span className="font-semibold tabular-nums text-rose-900">
                    {fmtInt(r.count)}
                  </span>
                </div>
              ))}
              {quarantine_reasons.length === 0 ? (
                <p className="text-sm text-rose-900/70">Zatím bez důvodů.</p>
              ) : null}
            </div>

            <div className="mt-5">
              <Link
                href={reviewQuarantineHref()}
                className="inline-flex items-center justify-center rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-600/20 hover:bg-rose-700"
              >
                👉 Otevřít karanténu
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ROW 4 */}
      <section className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
          <div className="border-b border-slate-200 bg-white px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">
              Dávky vyžadující zásah
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Konkrétní věci, které je potřeba řešit.
            </p>
          </div>
          <div className="px-6 py-5 space-y-3">
            {problem_batches.length ? (
              problem_batches.map((b) => (
                <div
                  key={b.batch_id}
                  className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold capitalize text-slate-900">{b.title}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {b.error_message
                          ? `Chyba: ${b.error_message}`
                          : `${fmtInt(b.pending_review_count)} čeká na kontrolu`}
                      </p>
                    </div>
                    {b.batch_id && b.batch_id !== "demo-1" && b.batch_id !== "demo-2" && b.batch_id !== "demo-3" ? (
                      <Link
                        href={`/batches/${b.batch_id}`}
                        className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 hover:bg-indigo-700"
                      >
                        Otevřít →
                      </Link>
                    ) : (
                      <Link
                        href="/batches"
                        className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 hover:bg-indigo-700"
                      >
                        Otevřít →
                      </Link>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">Zatím nic nehoří.</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
          <div className="border-b border-slate-200 bg-white px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">Poslední aktivita</h2>
            <p className="mt-1 text-sm text-slate-600">Auditní timeline.</p>
          </div>
          <div className="px-6 py-5 space-y-3">
            {activity.length ? (
              activity.slice(0, 10).map((a, idx) => (
                <div key={idx} className="flex gap-3">
                  <ActivityDot kind={a.kind} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{a.text}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {new Date(a.at).toLocaleString("cs-CZ")}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">Zatím žádná aktivita.</p>
            )}
          </div>
        </div>
      </section>

      {/* HOT NOW (operativa) – summary cards */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCard({
          label: "Letáky čekající na kontrolu",
          value: fmtInt(hot_now.batches_waiting_review),
          sub: "Co hoří teď",
          accent: "orange",
        })}
        {kpiCard({
          label: "Otevřené alerty",
          value: fmtInt(hot_now.open_alerts),
          sub: "Co hoří teď",
          accent: "red",
        })}
        {kpiCard({
          label: "Importy v chybě",
          value: fmtInt(hot_now.imports_error),
          sub: "Co hoří teď",
          accent: "red",
        })}
        {kpiCard({
          label: "Dávky v karanténě",
          value: fmtInt(hot_now.batches_quarantine),
          sub: "Co hoří teď",
          accent: "purple",
        })}
      </section>
    </main>
  );
}

