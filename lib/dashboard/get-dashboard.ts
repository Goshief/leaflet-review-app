import { unstable_cache } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  buildTrendFromDayKeys,
  DASHBOARD_TZ,
  dayKeyInTz,
  mapQuarantineReasonToMetricStatus,
  resolveMetricTimestamp,
  type MetricStatus,
  recentDayKeysInTz,
} from "@/lib/dashboard/metrics";

export type DashboardKpis = {
  inserted: number;
  approved: number;
  quarantined: number;
  rejected: number;
  pending: number;
  approval_rate_pct: number | null;
};

export type DashboardAlert = {
  kind: "error" | "warning" | "info";
  text: string;
  href?: string | null;
};

export type DashboardTrendPoint = {
  date: string; // YYYY-MM-DD
  inserted: number;
  approved: number;
  quarantined: number;
  rejected: number;
  pending: number;
};

export type RetailerBreakdownRow = {
  retailer: string;
  inserted: number;
  approved: number;
  quarantined: number;
  rejected: number;
  success_pct: number | null;
};

export type RetailerDominanceRow = {
  retailer: string;
  value: number;
};

export type QuarantineReasonRow = { reason: string; count: number };

export type ProblemBatchRow = {
  batch_id: string;
  retailer: string;
  title: string;
  status: string;
  pending_review_count: number;
  quarantined_count: number;
  error_message: string | null;
};

export type ActivityItem = {
  at: string;
  text: string;
  kind: "ok" | "warn" | "error" | "info";
};

export type DashboardData =
  | {
      ok: true;
      configured: true;
      today: DashboardKpis;
      hot_now: {
        batches_waiting_review: number;
        open_alerts: number;
        imports_error: number;
        batches_quarantine: number;
      };
      alerts: DashboardAlert[];
      trend_7d: DashboardTrendPoint[];
      trend_30d: DashboardTrendPoint[];
      dominance_inserted: RetailerDominanceRow[];
      dominance_approved: RetailerDominanceRow[];
      dominance_quarantined: RetailerDominanceRow[];
      quality_by_retailer: RetailerBreakdownRow[];
      quarantine_reasons: QuarantineReasonRow[];
      problem_batches: ProblemBatchRow[];
      activity: ActivityItem[];
    }
  | {
      ok: true;
      configured: false;
      reason: "not_configured";
      message: string;
      demo: {
        today: DashboardKpis;
        hot_now: {
          batches_waiting_review: number;
          open_alerts: number;
          imports_error: number;
          batches_quarantine: number;
        };
        alerts: DashboardAlert[];
        trend_7d: DashboardTrendPoint[];
        dominance_inserted: RetailerDominanceRow[];
        quality_by_retailer: RetailerBreakdownRow[];
        quarantine_reasons: QuarantineReasonRow[];
        problem_batches: ProblemBatchRow[];
        activity: ActivityItem[];
      };
    };

function yyyyMmDd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function isTruthy(v: string | undefined): boolean {
  const x = (v ?? "").trim().toLowerCase();
  return x === "1" || x === "true" || x === "yes" || x === "on";
}

/** ISO timestamp pro filtr řádků v DB (trend max 30 dní + rezerva). */
function isoUtcDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

/** Jak dlouho držet výsledek dashboardu v Next Data Cache (sekundy). */
const DASHBOARD_REVALIDATE_SEC = Math.min(
  120,
  Math.max(10, Number(process.env.DASHBOARD_CACHE_SECONDS ?? 25) || 25)
);

function computeApprovalRatePct(inserted: number, approved: number): number | null {
  if (!inserted) return null;
  return Math.round((approved / inserted) * 1000) / 10;
}

function groupCounts<T extends { retailer: string }>(
  rows: T[],
  getInserted: (r: T) => number,
  getApproved: (r: T) => number,
  getQuarantined: (r: T) => number,
  getRejected: (r: T) => number
): RetailerBreakdownRow[] {
  const map = new Map<string, RetailerBreakdownRow>();
  for (const r of rows) {
    const key = (r.retailer || "unknown").toLowerCase();
    const prev =
      map.get(key) ??
      ({
        retailer: key,
        inserted: 0,
        approved: 0,
        quarantined: 0,
        rejected: 0,
        success_pct: null,
      } satisfies RetailerBreakdownRow);
    prev.inserted += getInserted(r);
    prev.approved += getApproved(r);
    prev.quarantined += getQuarantined(r);
    prev.rejected += getRejected(r);
    map.set(key, prev);
  }
  const out = Array.from(map.values());
  out.forEach((x) => (x.success_pct = computeApprovalRatePct(x.inserted, x.approved)));
  out.sort((a, b) => b.inserted - a.inserted);
  return out;
}

function mkDemo(): DashboardData {
  const today: DashboardKpis = {
    inserted: 1284,
    approved: 1102,
    quarantined: 17,
    rejected: 65,
    pending: 94,
    approval_rate_pct: 85.8,
  };
  const hot_now = {
    batches_waiting_review: 3,
    open_alerts: 4,
    imports_error: 2,
    batches_quarantine: 2,
  };
  const alerts: DashboardAlert[] = [
    { kind: "error", text: "2 importy selhaly", href: "/batches" },
    { kind: "warning", text: "17 produktů je v karanténě", href: "/review?filter=quarantined" },
    { kind: "warning", text: "1 parser má zvýšenou chybovost", href: "/parsers" },
  ];
  const base = startOfDay(new Date());
  const trend_7d: DashboardTrendPoint[] = Array.from({ length: 7 }, (_, idx) => {
    const d = addDays(base, -6 + idx);
    const inserted = [820, 1040, 1284, 1110, 970, 1150, 1284][idx] ?? 0;
    const approved = Math.round(inserted * 0.86);
    const quarantined = Math.max(5, Math.round(inserted * 0.015));
    const rejected = Math.max(10, Math.round(inserted * 0.05));
    const pending = Math.max(0, inserted - approved - quarantined - rejected);
    return { date: yyyyMmDd(d), inserted, approved, quarantined, rejected, pending };
  });
  const dominance_inserted: RetailerDominanceRow[] = [
    { retailer: "lidl", value: 482 },
    { retailer: "kaufland", value: 311 },
    { retailer: "penny", value: 196 },
    { retailer: "billa", value: 174 },
    { retailer: "albert", value: 121 },
  ];
  const quality_by_retailer: RetailerBreakdownRow[] = [
    { retailer: "lidl", inserted: 482, approved: 441, quarantined: 9, rejected: 18, success_pct: 91.5 },
    { retailer: "kaufland", inserted: 311, approved: 249, quarantined: 22, rejected: 31, success_pct: 80.1 },
    { retailer: "penny", inserted: 196, approved: 171, quarantined: 4, rejected: 12, success_pct: 87.2 },
    { retailer: "billa", inserted: 174, approved: 121, quarantined: 19, rejected: 23, success_pct: 69.5 },
  ];
  const quarantine_reasons: QuarantineReasonRow[] = [
    { reason: "bez ceny", count: 9 },
    { reason: "neznámá jednotka", count: 5 },
    { reason: "podezření duplicita", count: 3 },
  ];
  const problem_batches: ProblemBatchRow[] = [
    {
      batch_id: "demo-1",
      retailer: "kaufland",
      title: "Kaufland 26.3.–1.4.",
      status: "review",
      pending_review_count: 0,
      quarantined_count: 22,
      error_message: null,
    },
    {
      batch_id: "demo-2",
      retailer: "billa",
      title: "Billa 25.3.–31.3.",
      status: "error",
      pending_review_count: 0,
      quarantined_count: 0,
      error_message: "Parser chyba, import zastaven",
    },
    {
      batch_id: "demo-3",
      retailer: "lidl",
      title: "Lidl 24.3.–30.3.",
      status: "review",
      pending_review_count: 8,
      quarantined_count: 0,
      error_message: null,
    },
  ];
  const activity: ActivityItem[] = [
    { at: new Date().toISOString(), kind: "ok", text: "Import Lidl dokončen" },
    { at: new Date().toISOString(), kind: "ok", text: "71 produktů schváleno" },
    { at: new Date().toISOString(), kind: "warn", text: "5 produktů zamítnuto" },
    { at: new Date().toISOString(), kind: "error", text: "Parser Penny restartován" },
  ];

  return {
    ok: true,
    configured: false,
    reason: "not_configured",
    message:
      "Supabase není nakonfigurované. Doplň NEXT_PUBLIC_SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY do .env.local.",
    demo: {
      today,
      hot_now,
      alerts,
      trend_7d,
      dominance_inserted,
      quality_by_retailer,
      quarantine_reasons,
      problem_batches,
      activity,
    },
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.info("[dashboard] configured:false reason=supabase_missing", {
      has_url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      has_service_role_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    });
    return mkDemo();
  }

  return unstable_cache(
    async () => computeDashboardData(supabase),
    ["dashboard-data-v2"],
    { revalidate: DASHBOARD_REVALIDATE_SEC }
  )();
}

async function computeDashboardData(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>
): Promise<DashboardData> {
  const verbose = isTruthy(process.env.DASHBOARD_DEBUG_METRICS);
  if (verbose) {
    console.info("[dashboard] configured:true", {
      has_url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      has_service_role_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    });
  }

  const now = new Date();
  const dayKeys30Arr = recentDayKeysInTz(30, now.toISOString(), DASHBOARD_TZ);
  const dayKeys7Arr = dayKeys30Arr.slice(-7);
  const dayKeys30 = new Set(dayKeys30Arr);
  const todayKey = dayKeys30Arr[dayKeys30Arr.length - 1] ?? (dayKeyInTz(now.toISOString()) ?? yyyyMmDd(now));

  /** Ořez řádků v DB — dříve 3× 5000 bez filtru = pomalý přenos a CPU. */
  const windowStartIso = isoUtcDaysAgo(45);

  const [importsRes, rawRes, quarantineResInitial] = await Promise.all([
    supabase
      .from("imports")
      .select("id, source_type, source_url, note, created_at, batch_no")
      .gte("created_at", windowStartIso)
      .order("created_at", { ascending: false })
      .limit(4000),
    supabase
      .from("offers_raw")
      .select("id,import_id,store_id,source_type,created_at")
      .gte("created_at", windowStartIso)
      .order("created_at", { ascending: false })
      .limit(25000),
    supabase
      .from("offers_quarantine")
      .select("id,import_id,store_id,source_type,quarantine_reason,reviewed_at,created_at")
      .or(`reviewed_at.gte."${windowStartIso}",created_at.gte."${windowStartIso}"`)
      .limit(25000),
  ]);

  const quarantineRes = quarantineResInitial.error
    ? await supabase
        .from("offers_quarantine")
        .select("id,import_id,store_id,source_type,quarantine_reason,created_at")
        .gte("created_at", windowStartIso)
        .limit(25000)
    : quarantineResInitial;

  if (verbose) {
    console.info(
      `[dashboard] imports_count=${importsRes.data?.length ?? 0} raw_count=${
        rawRes.data?.length ?? 0
      } quarantine_count=${quarantineRes.data?.length ?? 0}`
    );
  }

  if (importsRes.error || rawRes.error || quarantineRes.error) {
    console.error("[dashboard] configured:false reason=query_failed", {
      imports_error: importsRes.error?.message ?? null,
      offers_raw_error: rawRes.error?.message ?? null,
      offers_quarantine_error: quarantineRes.error?.message ?? null,
      has_url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      has_service_role_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    });
    return mkDemo();
  }

  const imports = (importsRes.data ?? []) as Array<any>;
  const raw = (rawRes.data ?? []) as Array<any>;
  const quarantine = (quarantineRes.data ?? []) as Array<any>;
  const importCreatedAtById = new Map<string, string>();
  for (const imp of imports) {
    const id = imp?.id ? String(imp.id) : "";
    const createdAt = imp?.created_at ? String(imp.created_at) : "";
    if (id && createdAt) importCreatedAtById.set(id, createdAt);
  }

  type MetricEvent = {
    import_id: string | null;
    retailer: string;
    status: MetricStatus;
    day_key: string;
    created_at: string;
    reason: string | null;
  };

  const events: MetricEvent[] = [];
  let skippedRawMissingTimestamp = 0;
  let skippedQuarantineMissingTimestamp = 0;
  const rawLoadedBeforeWindow = raw.length;
  const quarantineLoadedBeforeWindow = quarantine.length;
  let rawWithResolvedTimestamp = 0;
  let rawIn30dWindow = 0;
  let quarantineIn30dWindow = 0;
  for (const r of raw) {
    const importId = r.import_id ? String(r.import_id) : "";
    const parentImportTs = importId ? importCreatedAtById.get(importId) ?? null : null;
    const eventTs = resolveMetricTimestamp(
      r.created_at ? String(r.created_at) : null,
      parentImportTs
    );
    if (!eventTs) {
      skippedRawMissingTimestamp += 1;
      continue;
    }
    rawWithResolvedTimestamp += 1;
    const dayKey = dayKeyInTz(eventTs, DASHBOARD_TZ);
    if (!dayKey || !dayKeys30.has(dayKey)) continue;
    rawIn30dWindow += 1;
    events.push({
      import_id: importId || null,
      retailer: (r.store_id ?? r.source_type ?? "unknown").toString().toLowerCase(),
      status: "approved",
      day_key: dayKey,
      created_at: eventTs,
      reason: null,
    });
  }
  for (const q of quarantine) {
    const importId = q.import_id ? String(q.import_id) : "";
    const parentImportTs = importId ? importCreatedAtById.get(importId) ?? null : null;
    const eventTs = resolveMetricTimestamp(
      q.reviewed_at ? String(q.reviewed_at) : null,
      q.created_at ? String(q.created_at) : null,
      parentImportTs
    );
    if (!eventTs) {
      skippedQuarantineMissingTimestamp += 1;
      continue;
    }
    const dayKey = dayKeyInTz(eventTs, DASHBOARD_TZ);
    if (!dayKey || !dayKeys30.has(dayKey)) continue;
    quarantineIn30dWindow += 1;
    const reason = (q.quarantine_reason ?? "").toString().toLowerCase();
    const status = mapQuarantineReasonToMetricStatus(reason);
    events.push({
      import_id: importId || null,
      retailer: (q.store_id ?? q.source_type ?? "unknown").toString().toLowerCase(),
      status,
      day_key: dayKey,
      created_at: eventTs,
      reason: reason || null,
    });
  }
  const dayKeys7 = new Set(dayKeys7Arr);
  const events7d = events.filter((e) => dayKeys7.has(e.day_key)).length;
  const events30d = events.length;
  if (verbose) {
    console.info(`[dashboard] raw_loaded_before_window=${rawLoadedBeforeWindow}`);
    console.info(`[dashboard] raw_with_resolved_timestamp=${rawWithResolvedTimestamp}`);
    console.info(`[dashboard] raw_in_30d_window=${rawIn30dWindow}`);
    console.info(`[dashboard] quarantine_loaded_before_window=${quarantineLoadedBeforeWindow}`);
    console.info(`[dashboard] quarantine_in_30d_window=${quarantineIn30dWindow}`);
    console.info(`[dashboard] raw_missing_timestamp_after_fallback=${skippedRawMissingTimestamp}`);
    console.info(`[dashboard] events_created=${events.length}`);
    console.info(`[dashboard] skipped_raw_missing_timestamp=${skippedRawMissingTimestamp}`);
    console.info(
      `[dashboard] skipped_quarantine_missing_timestamp=${skippedQuarantineMissingTimestamp}`
    );
    console.info(`[dashboard] trend_7d_events=${events7d}`);
    console.info(`[dashboard] trend_30d_events=${events30d}`);
  }

  const todayEvents = events.filter((e) => e.day_key === todayKey);
  const today: DashboardKpis = {
    inserted: todayEvents.length,
    approved: todayEvents.filter((e) => e.status === "approved").length,
    quarantined: todayEvents.filter((e) => e.status === "quarantine").length,
    rejected: todayEvents.filter((e) => e.status === "rejected").length,
    pending: todayEvents.filter((e) => e.status === "pending").length,
    approval_rate_pct: null,
  };
  today.approval_rate_pct = computeApprovalRatePct(today.inserted, today.approved);

  const statusByImport = new Map<
    string,
    { approved: number; quarantine: number; rejected: number; pending: number }
  >();
  for (const e of events) {
    const importId = e.import_id ?? "";
    if (!importId) continue;
    const prev = statusByImport.get(importId) ?? {
      approved: 0,
      quarantine: 0,
      rejected: 0,
      pending: 0,
    };
    prev[e.status] += 1;
    statusByImport.set(importId, prev);
  }

  const hot_now = {
    batches_waiting_review: Array.from(statusByImport.values()).filter((x) => x.pending > 0).length,
    open_alerts: 0,
    imports_error: imports.filter((imp) => String(imp.note ?? "").toLowerCase().includes("error")).length,
    batches_quarantine: Array.from(statusByImport.values()).filter((x) => x.quarantine > 0).length,
  };

  const alerts: DashboardAlert[] = [];
  if (hot_now.imports_error > 0) {
    alerts.push({ kind: "error", text: `${hot_now.imports_error} importy selhaly`, href: "/batches" });
  }
  if (today.quarantined > 0)
    alerts.push({
      kind: "warning",
      text: `${today.quarantined} produktů je dnes v karanténě`,
      href: "/history",
    });
  if (today.pending > 0)
    alerts.push({
      kind: "warning",
      text: `${today.pending} položek čeká na kontrolu`,
      href: "/review?tab=pending&filter=pending",
    });
  hot_now.open_alerts = alerts.length;

  const trend_7d: DashboardTrendPoint[] = buildTrendFromDayKeys(dayKeys7Arr, events);
  const trend_30d: DashboardTrendPoint[] = buildTrendFromDayKeys(dayKeys30Arr, events);
  if (verbose) {
    console.info(`[dashboard] today=${JSON.stringify(today)}`);
    console.info(`[dashboard] trend_7d=${JSON.stringify(trend_7d)}`);
    console.info(`[dashboard] trend_30d=${JSON.stringify(trend_30d)}`);
  }

  const insertedRows = events.map((e) => ({
    retailer: e.retailer,
    kind:
      e.status === "approved"
        ? ("approved" as const)
        : e.status === "quarantine"
          ? ("quarantined" as const)
          : e.status === "rejected"
            ? ("rejected" as const)
            : ("pending" as const),
  }));
  const quality_by_retailer = groupCounts(
    insertedRows,
    () => 1,
    (x) => (x.kind === "approved" ? 1 : 0),
    (x) => (x.kind === "quarantined" ? 1 : 0),
    () => 0
  );

  function dominance(metric: "inserted" | "approved" | "quarantined"): RetailerDominanceRow[] {
    return quality_by_retailer
      .map((r) => ({
        retailer: r.retailer,
        value: metric === "inserted" ? r.inserted : metric === "approved" ? r.approved : r.quarantined,
      }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }

  const dominance_inserted = dominance("inserted");
  const dominance_approved = dominance("approved");
  const dominance_quarantined = dominance("quarantined");

  const quarantine_reasons_map = new Map<string, number>();
  const quarantineReasonSource = events.filter((e) => e.status === "quarantine" && !!e.reason);
  for (const q of quarantineReasonSource) {
    const r = (q.reason ?? "neuvedeno").toString().trim().toLowerCase() || "neuvedeno";
    quarantine_reasons_map.set(r, (quarantine_reasons_map.get(r) ?? 0) + 1);
  }
  const quarantine_reasons = Array.from(quarantine_reasons_map.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const rawCountByImport = new Map<string, number>();
  const qCountByImport = new Map<string, number>();
  const rejectedCountByImport = new Map<string, number>();
  const pendingCountByImport = new Map<string, number>();
  for (const e of events) {
    const id = String(e.import_id ?? "");
    if (!id) continue;
    if (e.status === "approved") rawCountByImport.set(id, (rawCountByImport.get(id) ?? 0) + 1);
    else if (e.status === "quarantine") qCountByImport.set(id, (qCountByImport.get(id) ?? 0) + 1);
    else if (e.status === "rejected")
      rejectedCountByImport.set(id, (rejectedCountByImport.get(id) ?? 0) + 1);
    else if (e.status === "pending")
      pendingCountByImport.set(id, (pendingCountByImport.get(id) ?? 0) + 1);
  }

  const problem_batches: ProblemBatchRow[] = (imports ?? [])
    .slice(0, 50)
    .map((imp) => {
      const id = String(imp.id);
      const qCount = qCountByImport.get(id) ?? 0;
      const rawCount = rawCountByImport.get(id) ?? 0;
      const rejectedCount = rejectedCountByImport.get(id) ?? 0;
      const pendingCount = pendingCountByImport.get(id) ?? 0;
      const titleParts = [
        imp.source_type ? String(imp.source_type) : null,
        imp.batch_no != null ? `#${imp.batch_no}` : null,
        String(imp.created_at ?? "").slice(0, 10) || null,
      ].filter(Boolean);
      return {
        batch_id: id,
        retailer: (imp.source_type ?? "unknown") as string,
        title: titleParts.join(" · ") || id,
        status: String(imp.note ?? "").toLowerCase().includes("error") ? "error" : "committed",
        pending_review_count: pendingCount,
        quarantined_count: qCount,
        error_message:
          String(imp.note ?? "").toLowerCase().includes("error")
            ? (imp.note as string)
            : rejectedCount > 0
              ? `zamítnuto: ${rejectedCount}`
              : null,
      } satisfies ProblemBatchRow;
    })
    .sort(
      (a, b) =>
        b.quarantined_count + b.pending_review_count - (a.quarantined_count + a.pending_review_count)
    )
    .slice(0, 6);

  const activity: ActivityItem[] = [];
  for (const imp of (imports ?? []).slice(0, 5)) {
    activity.push({
      at: imp.created_at,
      kind: "info",
      text: `${(imp.source_type ?? "import").toString()} · commit`,
    });
  }
  if (today.approved) {
    activity.unshift({
      at: new Date().toISOString(),
      kind: "ok",
      text: `Dnes odesláno do DB: ${today.approved} produktů`,
    });
  }

  if (isTruthy(process.env.DASHBOARD_DEBUG_METRICS)) {
    console.info("[dashboard-metrics]", {
      tz: DASHBOARD_TZ,
      today_key: todayKey,
      events_30d: events.length,
      today,
      hot_now,
      sample_reasons: quarantine_reasons.slice(0, 3),
    });
  }

  return {
    ok: true,
    configured: true,
    today,
    hot_now,
    alerts,
    trend_7d,
    trend_30d,
    dominance_inserted,
    dominance_approved,
    dominance_quarantined,
    quality_by_retailer,
    quarantine_reasons,
    problem_batches,
    activity,
  };
}




