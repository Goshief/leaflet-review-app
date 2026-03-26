import assert from "node:assert/strict";
import {
  buildTrendFromDayKeys,
  dayKeyInTz,
  recentDayKeysInTz,
  resolveMetricTimestamp,
  type TrendEvent,
} from "../lib/dashboard/metrics.ts";

function mkDayKey(
  createdAt: string | null | undefined,
  secondary: string | null | undefined,
  parentImportTs: string | null | undefined
): string | null {
  const ts = resolveMetricTimestamp(createdAt, secondary, parentImportTs);
  if (!ts) return null;
  return dayKeyInTz(ts, "Europe/Prague");
}

const nowIso = "2026-03-25T12:00:00.000Z";
const keys7 = recentDayKeysInTz(7, nowIso, "Europe/Prague");
const keys30 = recentDayKeysInTz(30, nowIso, "Europe/Prague");

// Case 1: raw without created_at but with imported_at; quarantine without created_at but with reviewed_at.
const rawFallbackKey = mkDayKey(undefined, "2026-03-24T18:30:00.000Z", undefined);
const qFallbackKey = mkDayKey(undefined, "2026-03-25T08:10:00.000Z", undefined);
assert.ok(rawFallbackKey, "raw imported_at fallback must resolve");
assert.ok(qFallbackKey, "quarantine reviewed_at fallback must resolve");

// Case 2: missing row timestamps, but parent import timestamp exists.
const rawParentKey = mkDayKey(undefined, undefined, "2026-03-22T14:00:00.000Z");
const qParentKey = mkDayKey(undefined, undefined, "2026-03-22T14:00:00.000Z");
assert.ok(rawParentKey, "raw parent import timestamp fallback must resolve");
assert.ok(qParentKey, "quarantine parent import timestamp fallback must resolve");

const events: TrendEvent[] = [
  { day_key: rawFallbackKey!, status: "approved" },
  { day_key: rawFallbackKey!, status: "approved" },
  { day_key: rawFallbackKey!, status: "approved" }, // 3 approved yesterday-like
  { day_key: qFallbackKey!, status: "quarantine" },
  { day_key: qFallbackKey!, status: "quarantine" }, // 2 quarantine today-like
  { day_key: rawParentKey!, status: "rejected" }, // 1 rejected from parent import ts
];

const trend7 = buildTrendFromDayKeys(keys7, events);
const trend30 = buildTrendFromDayKeys(keys30, events);

assert.ok(
  trend7.some((p) => p.inserted > 0),
  "trend_7d must contain non-zero bucket when timestamp fallbacks resolve"
);
assert.ok(
  trend30.some((p) => p.inserted > 0),
  "trend_30d must contain non-zero bucket when timestamp fallbacks resolve"
);

assert.equal(trend7.reduce((sum, p) => sum + p.inserted, 0), 6);
assert.equal(trend30.reduce((sum, p) => sum + p.inserted, 0), 6);

console.log("OK: dashboard timestamp fallback tests passed");
