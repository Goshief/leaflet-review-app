import assert from "node:assert/strict";
import {
  canUseNonTransactionalFallback,
  isTruthyEnv,
} from "../lib/commit/fallback-policy.ts";

assert.equal(isTruthyEnv("true"), true);
assert.equal(isTruthyEnv("1"), true);
assert.equal(isTruthyEnv("yes"), true);
assert.equal(isTruthyEnv("on"), true);
assert.equal(isTruthyEnv("false"), false);
assert.equal(isTruthyEnv(undefined), false);

// production blocks non-transactional fallback by default
assert.equal(canUseNonTransactionalFallback("production", undefined), false);
assert.equal(canUseNonTransactionalFallback("production", "false"), false);
assert.equal(canUseNonTransactionalFallback("production", "1"), true);

// non-production keeps developer fallback enabled
assert.equal(canUseNonTransactionalFallback("development", undefined), true);
assert.equal(canUseNonTransactionalFallback("test", undefined), true);

console.log("OK: commit fallback policy tests passed");

