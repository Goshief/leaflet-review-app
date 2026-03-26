import assert from "node:assert/strict";
import { getReviewEmptyState } from "../lib/review/empty-state.ts";

// "1/7 karanténní filtr" style scenario -> data exist, filtered list has one.
assert.equal(getReviewEmptyState(7, 1), "has_data");

// Critical false-empty scenario (0/7) should be classified as filtered_out, not no_data.
assert.equal(getReviewEmptyState(7, 0), "filtered_out");

// Truly empty dataset.
assert.equal(getReviewEmptyState(0, 0), "no_data");

console.log("OK: review filter empty-state tests passed");

