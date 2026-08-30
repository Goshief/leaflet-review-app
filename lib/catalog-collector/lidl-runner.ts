import type { SupabaseClient } from "@supabase/supabase-js";
import { runCatalogCollector } from "./generic-runner";
import { lidlAdapter } from "./lidl";
import type { CatalogRunStats } from "./types";

export function runLidlCatalogCollector(
  supabase: SupabaseClient,
  options?: { limit?: number }
): Promise<CatalogRunStats> {
  return runCatalogCollector(supabase, lidlAdapter, options);
}
