import assert from "node:assert/strict";
import { reviewQuarantineHref } from "../lib/nav/quarantine.ts";

const href = reviewQuarantineHref();
assert.equal(href, "/review?tab=quarantine&filter=quarantine");

const u = new URL(`http://localhost${href}`);
assert.equal(u.pathname, "/review");
assert.equal(u.searchParams.get("tab"), "quarantine");
assert.equal(u.searchParams.get("filter"), "quarantine");

console.log("OK: overview -> quarantine routing tests passed");

