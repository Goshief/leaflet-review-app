import assert from "node:assert/strict";
import {
  DASHBOARD_TZ,
  buildTrendFromDayKeys,
  dayKeyInTz,
  recentDayKeysInTz,
  resolveMetricTimestamp,
  type TrendEvent,
} from "../lib/dashboard/metrics.ts";

const nowIso = "2026-03-25T12:00:00.000Z";
const dayKeys30 = recentDayKeysInTz(30, nowIso, DASHBOARD_TZ);
const dayKeys30Set = new Set(dayKeys30);
const todayKey = dayKeys30[dayKeys30.length - 1]!;

// Parent import created yesterday.
const parentImportCreatedAt = "2026-03-24T09:10:00.000Z";

// Raw row has null created_at, but valid import_id.
const rawCreatedAt: string | null = null;
const resolvedRawTs = resolveMetricTimestamp(rawCreatedAt, parentImportCreatedAt);
assert.ok(resolvedRawTs, "raw timestamp must resolve from parent import created_at");

const rawDayKey = dayKeyInTz(resolvedRawTs, DASHBOARD_TZ);
assert.ok(rawDayKey, "raw day key must resolve");
assert.ok(dayKeys30Set.has(rawDayKey!), "raw row must remain inside 30-day window");

const events: TrendEvent[] = [{ day_key: rawDayKey!, status: "approved" }];
const trend30 = buildTrendFromDayKeys(dayKeys30, events);

// The fallbacked raw event must be counted in trend/KPI input.
assert.equal(
  trend30.reduce((sum, p) => sum + p.inserted, 0),
  1,
  "trend_30d must count raw row with null created_at via import fallback"
);
assert.equal(
  trend30.find((p) => p.date === rawDayKey)!.inserted,
  1,
  "bucket for resolved day key must include the fallbacked raw row"
);

// KPI-style inserted (today) should stay 0 because event is yesterday, but not dropped globally.
const todayInserted = events.filter((e) => e.day_key === todayKey).length;
assert.equal(todayInserted, 0);

console.log("OK: dashboard counts raw rows with null created_at via import timestamp fallback");
