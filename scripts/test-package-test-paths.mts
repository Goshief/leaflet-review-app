import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};

const scripts = pkg.scripts ?? {};
const testScriptEntries = Object.entries(scripts).filter(([name]) => name.startsWith("test:"));

/** Local paths that a test:* script may invoke directly. */
const LOCAL_PATH_RE =
  /(?:^|[\s"'=])((?:scripts|e2e)\/[A-Za-z0-9._/-]+\.(?:mts|ts|js|mjs|cjs|tsx|jsx))/g;

const missing: Array<{ script: string; path: string }> = [];

for (const [name, command] of testScriptEntries) {
  for (const match of command.matchAll(LOCAL_PATH_RE)) {
    const rel = match[1]!;
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      missing.push({ script: name, path: rel });
    }
  }
}

assert.equal(
  missing.length,
  0,
  missing.length === 0
    ? "ok"
    : `test:* scripts reference missing local files:\n${missing
        .map((m) => `  ${m.script} -> ${m.path}`)
        .join("\n")}`
);

console.log(
  `OK: package test paths — checked ${testScriptEntries.length} test:* scripts, no missing local files`
);
