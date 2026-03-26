export const DASHBOARD_TZ = "Europe/Prague";

export type MetricStatus = "approved" | "quarantine" | "rejected" | "pending";
export type TrendEvent = { day_key: string; status: MetricStatus };
export type TrendPoint = {
  date: string;
  inserted: number;
  approved: number;
  quarantined: number;
  rejected: number;
  pending: number;
};

export function dayKeyInTz(
  iso: string | null | undefined,
  timeZone = DASHBOARD_TZ
): string | null {
  const s = (iso ?? "").toString().trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function mapQuarantineReasonToMetricStatus(
  rawReason: string | null | undefined
): MetricStatus {
  const reason = (rawReason ?? "").toString().trim().toLowerCase();
  if (reason.startsWith("rejected_")) return "rejected";
  if (reason.startsWith("returned_")) return "pending";
  return "quarantine";
}

export function resolveMetricTimestamp(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const c of candidates) {
    const s = (c ?? "").toString().trim();
    if (!s) continue;
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) continue;
    return s;
  }
  return null;
}

export function pickEventDayKey(
  values: Array<string | null | undefined>,
  timeZone = DASHBOARD_TZ
): string | null {
  const ts = resolveMetricTimestamp(...values);
  return dayKeyInTz(ts, timeZone);
}

function toIsoDayFromUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function recentDayKeysInTz(
  days: number,
  nowIso: string | undefined = undefined,
  timeZone = DASHBOARD_TZ
): string[] {
  if (!Number.isFinite(days) || days <= 0) return [];
  const now = nowIso ? new Date(nowIso) : new Date();
  if (!Number.isFinite(now.getTime())) return [];
  const todayKey = dayKeyInTz(now.toISOString(), timeZone);
  if (!todayKey) return [];
  const [y, m, d] = todayKey.split("-").map(Number);
  if (!y || !m || !d) return [];
  const base = new Date(Date.UTC(y, m - 1, d));
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const x = new Date(base);
    x.setUTCDate(x.getUTCDate() - i);
    out.push(toIsoDayFromUtcDate(x));
  }
  return out;
}

export function buildTrendFromDayKeys(dayKeys: string[], events: TrendEvent[]): TrendPoint[] {
  return dayKeys.map((key) => {
    const dayEvents = events.filter((e) => e.day_key === key);
    const approved = dayEvents.filter((e) => e.status === "approved").length;
    const quarantined = dayEvents.filter((e) => e.status === "quarantine").length;
    const rejected = dayEvents.filter((e) => e.status === "rejected").length;
    const pending = dayEvents.filter((e) => e.status === "pending").length;
    return {
      date: key,
      inserted: dayEvents.length,
      approved,
      quarantined,
      rejected,
      pending,
    };
  });
}

