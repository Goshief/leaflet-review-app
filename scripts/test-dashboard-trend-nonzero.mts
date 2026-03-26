import assert from "node:assert/strict";
import {
  buildTrendFromDayKeys,
  dayKeyInTz,
  recentDayKeysInTz,
  type TrendEvent,
} from "../lib/dashboard/metrics.ts";

const nowIso = "2026-03-25T12:00:00.000Z";
const keys7 = recentDayKeysInTz(7, nowIso, "Europe/Prague");
const keys30 = recentDayKeysInTz(30, nowIso, "Europe/Prague");

const todayKey = keys7[keys7.length - 1];
const yesterdayKey = keys7[keys7.length - 2];
const threeDaysAgoKey = keys7[keys7.length - 4];

assert.ok(todayKey && yesterdayKey && threeDaysAgoKey);

// Valid timestamp must be bucketed by Europe/Prague day (UTC 23:30 = Prague next day).
assert.equal(dayKeyInTz("2026-03-24T23:30:00.000Z", "Europe/Prague"), "2026-03-25");

const events: TrendEvent[] = [
  { day_key: yesterdayKey!, status: "approved" },
  { day_key: yesterdayKey!, status: "approved" },
  { day_key: yesterdayKey!, status: "approved" },
  { day_key: todayKey!, status: "quarantine" },
  { day_key: todayKey!, status: "quarantine" },
  { day_key: threeDaysAgoKey!, status: "rejected" },
];

const trend7 = buildTrendFromDayKeys(keys7, events);
const trend30 = buildTrendFromDayKeys(keys30, events);

const nonZero7 = trend7.filter((x) => x.inserted > 0);
const nonZero30 = trend30.filter((x) => x.inserted > 0);

assert.ok(nonZero7.length >= 3, "trend_7d should have non-zero buckets");
assert.ok(nonZero30.length >= 3, "trend_30d should have non-zero buckets");
assert.equal(trend7.reduce((a, b) => a + b.inserted, 0), 6);
assert.equal(trend30.reduce((a, b) => a + b.inserted, 0), 6);

console.log("OK: dashboard trend non-zero tests passed");
