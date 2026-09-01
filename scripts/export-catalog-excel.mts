import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { CATALOG_RETAILER_IDS, getCatalogAdapter } from "../lib/catalog-collector/adapters.ts";
import { catalogProductsToCsvFiles, catalogProductsToXlsx } from "../lib/catalog-collector/excel.ts";
import { collectCatalogOffline } from "../lib/catalog-collector/offline-run.ts";
import { writeCatalogSnapshot } from "../lib/catalog-collector/snapshot.ts";
import type { CatalogProduct, CatalogRunStats } from "../lib/catalog-collector/types.ts";

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

const retailerArg = process.argv.find((arg) => arg.startsWith("--retailer="))?.slice(11) || "all";
const limitArg = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) || "40");
const limit = Number.isFinite(limitArg) ? limitArg : 40;
const retailers = retailerArg === "all" ? [...CATALOG_RETAILER_IDS] : [retailerArg];

const collectedAt = new Date().toISOString();
const allProducts: CatalogProduct[] = [];
const allRuns: CatalogRunStats[] = [];
const dir = path.join(process.cwd(), "exports");
await mkdir(dir, { recursive: true });

for (const retailer of retailers) {
  const adapter = getCatalogAdapter(retailer);
  if (!adapter) {
    console.error(`Unknown retailer. Use one of: all, ${CATALOG_RETAILER_IDS.join(", ")}`);
    process.exit(1);
  }
  const result = await collectCatalogOffline(adapter, { limit });
  allProducts.push(...result.products);
  allRuns.push(result.stats);
  const xlsx = catalogProductsToXlsx({ products: result.products, stats: result.stats, collectedAt });
  const csvFiles = catalogProductsToCsvFiles(result.products, collectedAt);
  const stamp = collectedAt.slice(0, 19).replace(/[:T]/g, "-");
  const base = path.join(dir, `catalog-${adapter.retailer}-${stamp}`);
  await writeFile(`${base}.xlsx`, xlsx);
  for (const [filename, csv] of Object.entries(csvFiles)) {
    await writeFile(`${base}-${filename}`, csv, "utf8");
  }
  await writeCatalogSnapshot(`catalog-${adapter.retailer}-latest.xlsx`, xlsx);
  console.log(
    JSON.stringify({
      ok: true,
      retailer: adapter.retailer,
      saved: result.stats.saved,
      failed: result.stats.failed,
      discovered: result.stats.discovered,
    })
  );
}

if (allRuns[0]) {
  const combined = catalogProductsToXlsx({
    products: allProducts,
    stats: allRuns[0],
    collectedAt,
    runs: allRuns,
  });
  await writeCatalogSnapshot("catalog-all-latest.xlsx", combined);
  await writeFile(path.join(dir, `catalog-all-${collectedAt.slice(0, 19).replace(/[:T]/g, "-")}.xlsx`), combined);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      retailers,
      saved: allProducts.length,
      files: retailers.map((id) => `public/catalog-exports/catalog-${id}-latest.xlsx`).concat(["public/catalog-exports/catalog-all-latest.xlsx"]),
    },
    null,
    2
  )
);
