import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { CATALOG_RETAILER_IDS, getCatalogAdapter } from "@/lib/catalog-collector/adapters";
import { catalogProductsToCsvFiles, catalogProductsToXlsx } from "@/lib/catalog-collector/excel";
import { collectCatalogOffline } from "@/lib/catalog-collector/offline-run";
import { requireOperatorApi } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function requestedLimit(req: Request) {
  const raw = new URL(req.url).searchParams.get("limit");
  if (!raw) return 12;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 12;
  return Math.max(1, Math.min(40, Math.floor(value)));
}

export async function GET(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const retailer = (url.searchParams.get("retailer") || "").trim().toLowerCase();
  const adapter = getCatalogAdapter(retailer);
  if (!adapter) {
    return NextResponse.json(
      { ok: false, error: "retailer must be one of: " + CATALOG_RETAILER_IDS.join(", ") },
      { status: 400 }
    );
  }

  try {
    const collectedAt = new Date().toISOString();
    const result = await collectCatalogOffline(adapter, { limit: requestedLimit(req) });
    const xlsx = catalogProductsToXlsx({
      products: result.products,
      stats: result.stats,
      collectedAt,
    });
    const csvFiles = catalogProductsToCsvFiles(result.products, collectedAt);
    const stamp = collectedAt.slice(0, 19).replace(/[:T]/g, "-");
    const base = `catalog-${adapter.retailer}-${stamp}`;
    const dir = path.join(process.cwd(), "exports");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${base}.xlsx`), xlsx);
    for (const [filename, csv] of Object.entries(csvFiles)) {
      await writeFile(path.join(dir, `${base}-${filename}`), csv, "utf8");
    }

    return new NextResponse(new Uint8Array(xlsx), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
        "Cache-Control": "no-store",
        "X-Catalog-Saved": String(result.stats.saved),
        "X-Catalog-Failed": String(result.stats.failed),
        "X-Catalog-Discovered": String(result.stats.discovered),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[catalog-excel]", { retailer, error: message });
    return NextResponse.json({ ok: false, retailer, error: message }, { status: 502 });
  }
}
