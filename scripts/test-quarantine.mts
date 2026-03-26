import assert from "node:assert/strict";
import { quarantineHomeHref, quarantineSearchHref, reviewQuarantineHref } from "../lib/nav/quarantine.ts";
import { parseQuarantineQuery } from "../lib/quarantine/query.ts";

assert.equal(quarantineHomeHref(), "/quarantine");
assert.equal(reviewQuarantineHref(), "/review?tab=quarantine&filter=quarantine");
assert.equal(quarantineSearchHref(""), "/quarantine");
assert.ok(quarantineSearchHref("import 123").startsWith("/quarantine?"));

{
  const r = parseQuarantineQuery("?q=vep%C5%99ov%C3%A1&onlyOpen=1");
  assert.equal(r.q, "vepřová");
  assert.equal(r.onlyOpen, true);
}
{
  const r = parseQuarantineQuery("q=abc&onlyOpen=0");
  assert.equal(r.q, "abc");
  assert.equal(r.onlyOpen, false);
}
{
  const r = parseQuarantineQuery("");
  assert.equal(r.q, "");
  assert.equal(r.onlyOpen, true);
}

console.log("OK: quarantine nav/query tests passed");

