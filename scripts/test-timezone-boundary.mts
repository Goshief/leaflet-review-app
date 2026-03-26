import assert from "node:assert/strict";
import { dayKeyInTz } from "../lib/dashboard/metrics.ts";

// UTC midnight boundary around CET/CEST business day.
const beforeUtcMidnight = "2026-03-24T23:30:00.000Z"; // Prague: 2026-03-25 00:30
const afterUtcMidnight = "2026-03-25T00:30:00.000Z"; // Prague: 2026-03-25 01:30

assert.equal(dayKeyInTz(beforeUtcMidnight, "UTC"), "2026-03-24");
assert.equal(dayKeyInTz(beforeUtcMidnight, "Europe/Prague"), "2026-03-25");
assert.equal(dayKeyInTz(afterUtcMidnight, "Europe/Prague"), "2026-03-25");

console.log("OK: timezone boundary tests passed");

