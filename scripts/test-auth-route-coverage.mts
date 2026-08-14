import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  API_ACCESS_MATRIX,
  PAGE_ACCESS_MATRIX,
  requiredApiAccess,
} from "../lib/auth/access-matrix.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walkApi(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkApi(p, out);
    else if (ent.name === "route.ts") {
      out.push(p.slice(root.length + 1).replace(/\\/g, "/"));
    }
  }
  return out;
}

function main() {
  const classified = new Set(API_ACCESS_MATRIX.map((r) => r.file));

  for (const rule of API_ACCESS_MATRIX) {
    assert.ok(existsSync(join(root, rule.file)), `matrix file missing: ${rule.file}`);
    const src = readFileSync(join(root, rule.file), "utf8");
    for (const [method, level] of Object.entries(rule.methods)) {
      assert.equal(requiredApiAccess(rule.file, method), level);
      assert.match(src, new RegExp(`export async function ${method}\\b`));
      if (level === "operator") {
        assert.match(src, /requireOperatorApi\s*\(/);
      } else if (level === "admin") {
        assert.match(src, /requireAdminApi\s*\(/);
      } else if (level === "public") {
        assert.equal(/requireOperatorApi\s*\(/.test(src), false);
        assert.equal(/requireAdminApi\s*\(/.test(src), false);
      }
    }
  }

  for (const file of walkApi(join(root, "app/api"))) {
    assert.ok(
      classified.has(file),
      `New API route without access-matrix entry: ${file}`
    );
  }

  // Sensitive markers must not appear in unclassified handlers — all are classified.
  for (const file of walkApi(join(root, "app/api"))) {
    const levelEntries = API_ACCESS_MATRIX.find((r) => r.file === file);
    assert.ok(levelEntries);
    const src = readFileSync(join(root, file), "utf8");
    const usesServiceRole =
      src.includes("getSupabaseAdmin") || src.includes("SUPABASE_SERVICE_ROLE_KEY");
    const usesPaidOrOcr =
      /openai|gemini|tesseract|runOcrPipeline|extractWordsFromImageBuffer/i.test(src);
    if (usesServiceRole || usesPaidOrOcr) {
      const levels = Object.values(levelEntries!.methods);
      // Explicit public exceptions (e.g. Setrik public offers) may mention env
      // flags without granting admin session access.
      if (levels.includes("public")) continue;
      assert.ok(
        levels.every((l) => l === "operator" || l === "admin"),
        `Sensitive route must not be public: ${file}`
      );
    }
  }

  for (const page of PAGE_ACCESS_MATRIX) {
    assert.ok(existsSync(join(root, page.guardModule)), page.guardModule);
    const src = readFileSync(join(root, page.guardModule), "utf8");
    if (page.access === "admin") assert.match(src, /requireAdminPage\s*\(/);
    if (page.access === "operator") assert.match(src, /requireOperatorPage\s*\(/);
  }

  console.log(
    `test-auth-route-coverage: ok — ${API_ACCESS_MATRIX.length} API rules, ${PAGE_ACCESS_MATRIX.length} page rules`
  );
}

try {
  main();
} catch (err) {
  console.error("test-auth-route-coverage: failed");
  console.error(err);
  process.exit(1);
}
