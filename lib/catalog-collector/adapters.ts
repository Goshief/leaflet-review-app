import { billaAdapter } from "./billa.ts";
import { dmAdapter } from "./dm.ts";
import { lidlAdapter } from "./lidl.ts";
import { rohlikAdapter } from "./rohlik.ts";
import { rossmannAdapter } from "./rossmann.ts";
import { tetaAdapter } from "./teta.ts";
import type { CatalogAdapter, CatalogRetailerId } from "./types.ts";

export const CATALOG_ADAPTERS: Record<CatalogRetailerId, CatalogAdapter> = {
  billa: billaAdapter,
  teta: tetaAdapter,
  dm: dmAdapter,
  lidl: lidlAdapter,
  rossmann: rossmannAdapter,
  rohlik: rohlikAdapter,
};

export const CATALOG_RETAILER_IDS = Object.keys(CATALOG_ADAPTERS) as CatalogRetailerId[];

export function getCatalogAdapter(retailer: string): CatalogAdapter | null {
  return CATALOG_ADAPTERS[retailer as CatalogRetailerId] ?? null;
}
