import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type QuarantineRow = {
  id: string;
  import_id: string;
  store_id: string | null;
  source_type: string | null;
  source_url: string | null;
  valid_from: string | null;
  valid_to: string | null;
  extracted_name: string | null;
  price_total: number | null;
  currency: string | null;
  pack_qty: number | null;
  pack_unit: string | null;
  pack_unit_qty: number | null;
  price_standard: number | null;
  typical_price_per_unit: number | null;
  price_with_loyalty_card: number | null;
  has_loyalty_card_price: boolean | null;
  notes: string | null;
  brand: string | null;
  category: string | null;
  quarantine_reason: string | null;
  created_at: string;
};

export type ImportMetaRow = {
  id: string;
  source_type: string;
  source_url: string | null;
  note: string | null;
  created_at: string;
  batch_no: number;
};

export type QuarantineListItem = QuarantineRow & {
  batch: ImportMetaRow | null;
  actor: string | null;
  original_filename: string | null;
};

function parseNote(note: string | null): { actor: string | null; file: string | null } {
  const parts = (note ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  let actor: string | null = null;
  let file: string | null = null;
  for (const p of parts) {
    if (p.startsWith("actor:")) actor = p.slice("actor:".length).trim() || actor;
    if (p.startsWith("file:")) file = p.slice("file:".length).trim() || file;
  }
  return { actor, file };
}

export type ListQuarantineResult =
  | { ok: true; configured: true; items: QuarantineListItem[] }
  | { ok: true; configured: false; reason: "not_configured"; message: string; items: [] }
  | { ok: false; configured: true; error: string; items: [] };

export async function listQuarantine(): Promise<ListQuarantineResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return {
      ok: true,
      configured: false,
      reason: "not_configured",
      message:
        "Supabase není nakonfigurované. Doplň NEXT_PUBLIC_SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY do .env.local.",
      items: [],
    };
  }

  const { data: q, error: qErr } = await supabase
    .from("offers_quarantine")
    .select(
      [
        "id",
        "import_id",
        "store_id",
        "source_type",
        "source_url",
        "valid_from",
        "valid_to",
        "extracted_name",
        "price_total",
        "currency",
        "pack_qty",
        "pack_unit",
        "pack_unit_qty",
        "price_standard",
        "typical_price_per_unit",
        "price_with_loyalty_card",
        "has_loyalty_card_price",
        "notes",
        "brand",
        "category",
        "quarantine_reason",
        "created_at",
      ].join(",")
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  if (qErr) return { ok: false, configured: true, error: qErr.message, items: [] };

  const rows = (q ?? []) as unknown as QuarantineRow[];
  const importIds = Array.from(new Set(rows.map((r) => r.import_id).filter(Boolean)));

  const { data: imports, error: impErr } = importIds.length
    ? await supabase
        .from("imports")
        .select("id, source_type, source_url, note, created_at, batch_no")
        .in("id", importIds)
        .limit(2000)
    : { data: [], error: null };

  if (impErr) return { ok: false, configured: true, error: impErr.message, items: [] };

  const impById = new Map<string, ImportMetaRow>();
  for (const x of (imports ?? []) as ImportMetaRow[]) impById.set(String(x.id), x);

  const items: QuarantineListItem[] = rows.map((r) => {
    const batch = impById.get(String(r.import_id)) ?? null;
    const parsed = parseNote(batch?.note ?? null);
    return {
      ...r,
      batch,
      actor: parsed.actor,
      original_filename: parsed.file,
    };
  });

  return { ok: true, configured: true, items };
}

