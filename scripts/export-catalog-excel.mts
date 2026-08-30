import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { CATALOG_RETAILER_IDS, getCatalogAdapter } from "../lib/catalog-collector/adapters.ts";
import { catalogProductsToCsvFiles, catalogProductsToXlsx } from "../lib/catalog-collector/excel.ts";
import { collectCatalogOffline } from "../lib/catalog-collector/offline-run.ts";

const neededFlags = ["--max-http-header-size=131072", "--use-system-ca"];
const missing = neededFlags.filter((flag) => !process.execArgv.includes(flag));
if (missing.length) {
  const result = spawnSync(
    process.execPath,
    [...neededFlags, ...process.execArgv, ...process.argv.slice(1)],
    { stdio: "inherit" }
  );
  process.exit(result.status ?? 1);
}

const retailerArg = process.argv.find((arg) => arg.startsWith("--retailer="))?.slice(11) || "lidl";
const limitArg = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) || "40");
const adapter = getCatalogAdapter(retailerArg);
if (!adapter) {
  console.error(`Unknown retailer. Use one of: ${CATALOG_RETAILER_IDS.join(", ")}`);
  process.exit(1);
}

const collectedAt = new Date().toISOString();
const result = await collectCatalogOffline(adapter, { limit: Number.isFinite(limitArg) ? limitArg : 40 });
const xlsx = catalogProductsToXlsx({ products: result.products, stats: result.stats, collectedAt });
const csvFiles = catalogProductsToCsvFiles(result.products, collectedAt);
const stamp = collectedAt.slice(0, 19).replace(/[:T]/g, "-");
const dir = path.join(process.cwd(), "exports");
await mkdir(dir, { recursive: true });
const base = path.join(dir, `catalog-${adapter.retailer}-${stamp}`);
await writeFile(`${base}.xlsx`, xlsx);
for (const [filename, csv] of Object.entries(csvFiles)) {
  await writeFile(`${base}-${filename}`, csv, "utf8");
}
console.log(
  JSON.stringify(
    {
      ok: true,
      file: `${base}.xlsx`,
      csv: Object.keys(csvFiles).map((name) => `${base}-${name}`),
      saved: result.stats.saved,
      failed: result.stats.failed,
      discovered: result.stats.discovered,
      tables: {
        retailer_products: result.products.length,
        retailer_offers_current: result.products.length,
        retailer_price_observations: result.products.length,
      },
    },
    null,
    2
  )
);
