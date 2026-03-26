"use client";

import { HomeDashboard } from "@/components/dashboard/home-dashboard";
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
import { useEffect, useMemo, useState } from "react";

type CommitLogEntry = {
  committed_at?: string;
  actor?: string | null;
  retailer?: string;
  counts?: {
    staging?: number;
    approved?: number;
    rejected?: number;
    quarantined?: number;
    pending?: number;
  };
};

function startOfDayMs(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

function yyyyMmDd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function safeNum(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function readCommitLog(): CommitLogEntry[] {
  try {
    const raw = localStorage.getItem("leaflet_commit_log") ?? "[]";
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as CommitLogEntry[]) : [];
  } catch {
    return [];
  }
}

function sumCounts(entries: CommitLogEntry[]) {
  let inserted = 0;
  let approved = 0;
  let rejected = 0;
  let quarantined = 0;
  let pending = 0;
  for (const e of entries) {
    const c = e.counts ?? {};
    inserted += safeNum(c.staging);
    approved += safeNum(c.approved);
    rejected += safeNum(c.rejected);
    quarantined += safeNum(c.quarantined);
    pending += safeNum(c.pending);
  }
  return { inserted, approved, rejected, quarantined, pending };
}

function computeApprovalRatePct(inserted: number, approved: number): number | null {
  if (!inserted) return null;
  return Math.round((approved / inserted) * 1000) / 10;
}

export function LocalDashboard() {
  const [log, setLog] = useState<CommitLogEntry[]>([]);

  useEffect(() => {
    setLog(readCommitLog());
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === "leaflet_commit_log") setLog(readCommitLog());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const derived = useMemo(() => {
    const now = new Date();
    const today0 = startOfDayMs(now);

    const parsed = log
      .map((e) => {
        const t = (e.committed_at ?? "").toString();
        const ms = t ? Date.parse(t) : NaN;
        return { e, ms: Number.isFinite(ms) ? ms : null };
      })
      .filter((x) => x.ms != null) as Array<{ e: CommitLogEntry; ms: number }>;

    const todayEntries = parsed.filter((x) => x.ms >= today0).map((x) => x.e);
    const todaySum = sumCounts(todayEntries);

    // Trend 7d from commit log.
    const trend_7d: DashboardTrendPoint[] = Array.from({ length: 7 }, (_, idx) => {
      const d = new Date(today0);
      d.setDate(d.getDate() - (6 - idx));
      const day0 = startOfDayMs(d);
      const day1 = day0 + 24 * 3600 * 1000;
      const entries = parsed.filter((x) => x.ms >= day0 && x.ms < day1).map((x) => x.e);
      const s = sumCounts(entries);
      return {
        date: yyyyMmDd(new Date(day0)),
        inserted: s.inserted,
        approved: s.approved,
        quarantined: s.quarantined,
        rejected: s.rejected,
        pending: s.pending,
      };
    });

    // Dominance + quality by retailer from commit log (today).
    const byRetailer = new Map<string, ReturnType<typeof sumCounts>>();
    for (const e of todayEntries) {
      const r = (e.retailer ?? "unknown").toLowerCase();
      const prev = byRetailer.get(r) ?? { inserted: 0, approved: 0, rejected: 0, quarantined: 0, pending: 0 };
      const add = sumCounts([e]);
      byRetailer.set(r, {
        inserted: prev.inserted + add.inserted,
        approved: prev.approved + add.approved,
        rejected: prev.rejected + add.rejected,
        quarantined: prev.quarantined + add.quarantined,
        pending: prev.pending + add.pending,
      });
    }
    const dominance_inserted: RetailerDominanceRow[] = Array.from(byRetailer.entries())
      .map(([retailer, s]) => ({ retailer, value: s.inserted }))
      .sort((a, b) => b.value - a.value);
    const dominance_approved: RetailerDominanceRow[] = Array.from(byRetailer.entries())
      .map(([retailer, s]) => ({ retailer, value: s.approved }))
      .sort((a, b) => b.value - a.value);
    const dominance_quarantined: RetailerDominanceRow[] = Array.from(byRetailer.entries())
      .map(([retailer, s]) => ({ retailer, value: s.quarantined }))
      .sort((a, b) => b.value - a.value);

    const quality_by_retailer: RetailerBreakdownRow[] = Array.from(byRetailer.entries())
      .map(([retailer, s]) => ({
        retailer,
        inserted: s.inserted,
        approved: s.approved,
        quarantined: s.quarantined,
        rejected: s.rejected,
        success_pct: computeApprovalRatePct(s.inserted, s.approved),
      }))
      .sort((a, b) => b.inserted - a.inserted);

    const alerts: DashboardAlert[] = [];
    if (todaySum.pending > 0)
      alerts.push({
        kind: "warning",
        text: `${todaySum.pending} čeká na kontrolu`,
        href: "/review?tab=pending&filter=pending",
      });
    if (todaySum.quarantined > 0)
      alerts.push({
        kind: "warning",
        text: `${todaySum.quarantined} v karanténě`,
        href: "/review?tab=quarantine&filter=quarantine",
      });
    if (todaySum.rejected > 0) alerts.push({ kind: "info", text: `${todaySum.rejected} zamítnuto`, href: "/review?tab=rejected" });

    const activity: ActivityItem[] = parsed
      .slice(0, 12)
      .map((x) => {
        const c = x.e.counts ?? {};
        const a = safeNum(c.approved);
        const r = safeNum(c.rejected);
        const q = safeNum(c.quarantined);
        const t = x.e.committed_at ?? new Date(x.ms).toISOString();
        const parts: string[] = [];
        if (a) parts.push(`${a} produktů schváleno`);
        if (r) parts.push(`${r} produktů zamítnuto`);
        if (q) parts.push(`${q} v karanténě`);
        const text = parts.length ? parts.join(" · ") : "Commit";
        return { at: t, text, kind: q ? "warn" : "ok" } as ActivityItem;
      });

    const today: DashboardKpis = {
      inserted: todaySum.inserted,
      approved: todaySum.approved,
      quarantined: todaySum.quarantined,
      rejected: todaySum.rejected,
      pending: todaySum.pending,
      approval_rate_pct: computeApprovalRatePct(todaySum.inserted, todaySum.approved),
    };

    return {
      today,
      alerts,
      trend_7d,
      trend_30d: trend_7d,
      dominance_inserted,
      dominance_approved,
      dominance_quarantined,
      quality_by_retailer,
      quarantine_reasons: [] as QuarantineReasonRow[],
      problem_batches: [] as ProblemBatchRow[],
      activity,
      hot_now: {
        batches_waiting_review: today.pending > 0 ? 1 : 0,
        open_alerts: alerts.length,
        imports_error: 0,
        batches_quarantine: today.quarantined > 0 ? 1 : 0,
      },
    };
  }, [log]);

  return (
    <HomeDashboard
      configured={false}
      showDemoBadge={false}
      hot_now={derived.hot_now}
      alerts={[
        { kind: "info", text: "Lokální režim (bez Supabase) — data z historie commitů", href: "/history" },
        ...derived.alerts,
      ]}
      today={derived.today}
      trend_7d={derived.trend_7d}
      trend_30d={derived.trend_30d}
      dominance_inserted={derived.dominance_inserted}
      dominance_approved={derived.dominance_approved}
      dominance_quarantined={derived.dominance_quarantined}
      quality_by_retailer={derived.quality_by_retailer}
      quarantine_reasons={derived.quarantine_reasons}
      problem_batches={derived.problem_batches}
      activity={derived.activity}
    />
  );
}

