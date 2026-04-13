import assert from "node:assert/strict";

function isPositiveQuantity(v: unknown): boolean {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

assert.equal(isPositiveQuantity(1), true);
assert.equal(isPositiveQuantity("2"), true);
assert.equal(isPositiveQuantity(0), false);
assert.equal(isPositiveQuantity(-1), false);
assert.equal(isPositiveQuantity("x"), false);

console.log("OK: shopper input validation tests passed");
