import type { SupabaseClient } from "@supabase/supabase-js";
import { runCatalogCollector } from "./generic-runner";
import { rohlikAdapter } from "./rohlik";
import type { CatalogRunStats } from "./types";

export function runRohlikCatalogCollector(
  supabase: SupabaseClient,
  options?: { limit?: number }
): Promise<CatalogRunStats> {
  return runCatalogCollector(supabase, rohlikAdapter, options);
}
