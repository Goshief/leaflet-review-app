import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/test-catalog-billa-parser.mts"], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
