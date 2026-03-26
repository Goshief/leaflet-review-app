import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Načítání portovaných řádků z offers_raw / offers_quarantine.
 *
 * Počty na kartách dávek používají jen `select("import_id")` bez řazení — to skoro vždy projde.
 * Plné dotazy dřív padaly na:
 * - neexistující sloupec v select listu (image review sloupce apod.)
 * - řazení podle sloupce, který v jedné tabulce chybí nebo není v exposed schématu (`created_at`, …)
 *
 * Strategie: `select("*")`, řadit podle `id` (PK vždy existuje), při chybě zkusit bez `.order()`.
 */

const LIMIT_AGG = 5000;
const LIMIT_DETAIL = 4000;

type LoadResult<T> = {
  data: T[];
  error: string | null;
  count: number | null;
};

async function loadOneTable<T extends Record<string, unknown>>(args: {
  supabase: SupabaseClient;
  table: "offers_raw" | "offers_quarantine";
  importIds?: string[];
  importId?: string;
  limit: number;
  withCount: boolean;
}): Promise<LoadResult<T>> {
  const { supabase, table, importIds, importId, limit, withCount } = args;

  const build = (useOrder: boolean) => {
    let q = supabase
      .from(table)
      .select("*", withCount ? { count: "exact" } : undefined);

    if (importIds?.length) {
      q = q.in("import_id", importIds);
    } else if (importId) {
      q = q.eq("import_id", importId);
    } else {
      return null;
    }

    if (useOrder) {
      q = q.order("id", { ascending: false });
    }
    return q.limit(limit);
  };

  let res = build(true);
  if (!res) {
    return { data: [], error: "missing import filter", count: null };
  }

  let out = await res;
  if (out.error) {
    const retry = build(false);
    if (retry) {
      out = await retry;
    }
  }

  if (out.error) {
    return {
      data: [],
      error: out.error.message ?? String(out.error),
      count: withCount ? 0 : null,
    };
  }

  return {
    data: (out.data ?? []) as T[],
    error: null,
    count: typeof out.count === "number" ? out.count : null,
  };
}

export async function loadPortedItemsAggregated<T extends Record<string, unknown>>(args: {
  supabase: SupabaseClient;
  importIds: string[];
}): Promise<{
  raw: T[];
  quarantine: T[];
  rawError: string | null;
  quarantineError: string | null;
}> {
  const ids = args.importIds.map((x) => String(x).trim()).filter(Boolean);
  if (!ids.length) {
    return { raw: [], quarantine: [], rawError: null, quarantineError: null };
  }

  const [rawRes, qRes] = await Promise.all([
    loadOneTable<T>({
      supabase: args.supabase,
      table: "offers_raw",
      importIds: ids,
      limit: LIMIT_AGG,
      withCount: false,
    }),
    loadOneTable<T>({
      supabase: args.supabase,
      table: "offers_quarantine",
      importIds: ids,
      limit: LIMIT_AGG,
      withCount: false,
    }),
  ]);

  return {
    raw: rawRes.data,
    quarantine: qRes.data,
    rawError: rawRes.error,
    quarantineError: qRes.error,
  };
}

export async function loadPortedItemsForImport<T extends Record<string, unknown>>(args: {
  supabase: SupabaseClient;
  importId: string;
}): Promise<{
  raw: T[];
  quarantine: T[];
  rawCount: number;
  quarantineCount: number;
  loadError: string | null;
}> {
  const id = String(args.importId).trim();
  if (!id) {
    return {
      raw: [],
      quarantine: [],
      rawCount: 0,
      quarantineCount: 0,
      loadError: "missing import id",
    };
  }

  const [rawRes, qRes] = await Promise.all([
    loadOneTable<T>({
      supabase: args.supabase,
      table: "offers_raw",
      importId: id,
      limit: LIMIT_DETAIL,
      withCount: true,
    }),
    loadOneTable<T>({
      supabase: args.supabase,
      table: "offers_quarantine",
      importId: id,
      limit: LIMIT_DETAIL,
      withCount: true,
    }),
  ]);

  const errs = [rawRes.error, qRes.error].filter(Boolean) as string[];
  return {
    raw: rawRes.data,
    quarantine: qRes.data,
    rawCount: rawRes.count ?? rawRes.data.length,
    quarantineCount: qRes.count ?? qRes.data.length,
    loadError: errs.length ? errs.join(" | ") : null,
  };
}
