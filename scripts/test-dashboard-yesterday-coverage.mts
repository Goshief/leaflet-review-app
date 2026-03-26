import assert from "node:assert/strict";
import {
  buildTrendFromDayKeys,
  dayKeyInTz,
  recentDayKeysInTz,
  type TrendEvent,
} from "../lib/dashboard/metrics.ts";

const nowIso = "2026-03-25T12:00:00.000Z";
const keys30 = recentDayKeysInTz(30, nowIso, "Europe/Prague");
const keys7 = recentDayKeysInTz(7, nowIso, "Europe/Prague");
const yesterdayKey = keys30[keys30.length - 2];
assert.ok(yesterdayKey, "yesterday key must exist");

// 10 rows late in UTC evening; must map correctly to Prague day bucket.
const lateUtcYesterday = "2026-03-24T22:30:00.000Z"; // Prague: 23:30 on 2026-03-24
const bucket = dayKeyInTz(lateUtcYesterday, "Europe/Prague");
assert.equal(bucket, yesterdayKey);

const events: TrendEvent[] = Array.from({ length: 10 }, () => ({
  day_key: bucket!,
  status: "approved" as const,
}));

const trend7 = buildTrendFromDayKeys(keys7, events);
const trend30 = buildTrendFromDayKeys(keys30, events);

const y7 = trend7.find((p) => p.date === yesterdayKey);
const y30 = trend30.find((p) => p.date === yesterdayKey);
assert.ok(y7, "yesterday must exist in trend_7d");
assert.ok(y30, "yesterday must exist in trend_30d");
assert.equal(y7?.inserted, 10);
assert.equal(y30?.inserted, 10);

console.log("OK: dashboard yesterday coverage tests passed");
