import assert from "node:assert/strict";
import {
  getAvailableImageKeys,
  isValidImageKey,
} from "../lib/product-types/image-keys.ts";

const keys = getAvailableImageKeys();

assert.equal(Array.isArray(keys), true);
assert.equal(keys.length > 0, true);
assert.equal(keys.includes("butter"), true);
assert.equal(keys.includes("cheese"), true);
assert.equal(keys.includes("placeholder"), true);

assert.equal(isValidImageKey("butter"), true);
assert.equal(isValidImageKey("cheese"), true);
assert.equal(isValidImageKey("placeholder"), true);
assert.equal(isValidImageKey("unknown_key"), false);
assert.equal(isValidImageKey("uploaded-asset.png"), true);
assert.equal(isValidImageKey(""), false);
assert.equal(isValidImageKey(null), false);
assert.equal(isValidImageKey(undefined), false);

// Ensure callers cannot mutate source-of-truth accidentally.
keys.push("injected_key");
assert.equal(isValidImageKey("injected_key"), false);

console.log("OK: image keys helper tests passed");

