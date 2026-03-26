import fs from "node:fs";
import path from "node:path";

let cached: string | null = null;

export function getSystemPromptLidlCzStrict(): string {
  if (cached) return cached;
  const filePath = path.join(
    process.cwd(),
    "lib/lidl-parser/SYSTEM_PROMPT_LIDL_CZ_STRICT.md"
  );
  cached = fs.readFileSync(filePath, "utf8");
  return cached;
}
