import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const checklist = readFileSync("docs/RELEASE-CHECKLIST.md", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

const requiredChecklistItems = [
  "## 3) Shopper MVP Smoke Tests",
  "Browser session sets `cart_session` cookie before shopper API usage",
  "`POST /api/shopper/cart` creates/fetches active cart",
  "`POST /api/shopper/cart/items` adds cart item",
  "`PATCH /api/shopper/cart/items/:itemId` updates quantity",
  "`POST /api/shopper/plan` generates/recomputes active plan",
  "`GET /api/shopper/savings` returns baseline/optimized/savings summary",
  "Shopper planner uses only committed `offers_raw` data",
  "`npm run test:shopper-db-connection`",
  "`npm run test:shopper-planner`",
  "`npm run test:shopper-input-validation`",
  "`/api/health` returns `{ ok: true, status: \"ok\" }`",
];

for (const item of requiredChecklistItems) {
  assert.ok(
    checklist.includes(item),
    `Missing shopper release checklist item: ${item}`
  );
}

const requiredScripts = [
  "test:shopper-db-connection",
  "test:shopper-planner",
  "test:shopper-input-validation",
  "runtime:gate",
];

for (const scriptName of requiredScripts) {
  assert.ok(pkg.scripts?.[scriptName], `Missing package script: ${scriptName}`);
}

console.log("OK: shopper release checklist audit passed");
