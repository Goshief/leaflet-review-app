import type { SupabaseClient } from "@supabase/supabase-js";
import { runCatalogCollector } from "./generic-runner";
import { rossmannAdapter } from "./rossmann";
import type { CatalogRunStats } from "./types";

export function runRossmannCatalogCollector(
  supabase: SupabaseClient,
  options?: { limit?: number }
): Promise<CatalogRunStats> {
  return runCatalogCollector(supabase, rossmannAdapter, options);
}
