import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type ImportRow = {
  id: string;
  source_type: string;
  source_url: string | null;
  note: string | null;
  created_at: string;
  batch_no: number;
};

export type BatchStatus =
  | "nahráno"
  | "rozpracováno"
  | "ke kontrole"
  | "částečně schváleno"
  | "importováno"
  | "chyba";

export type ImportBatchListItem = ImportRow & {
  actor: string | null;
  original_filename: string | null;
  item_count: number;
  raw_count: number;
  quarantine_count: number;
  status: BatchStatus;
};

export type ListImportBatchesResult =
  | { ok: true; batches: ImportBatchListItem[] }
  | { ok: false; batches: []; reason: "not_configured" | "error"; message: string };

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

function deriveStatus(args: {
  raw_count: number;
  quarantine_count: number;
  note: string | null;
}): BatchStatus {
  const note = (args.note ?? "").toLowerCase();
  if (note.includes("error") || note.includes("chyba")) return "chyba";
  const raw = args.raw_count;
  const q = args.quarantine_count;
  if (raw > 0 && q === 0) return "importováno";
  if (raw > 0 && q > 0) return "částečně schváleno";
  if (raw === 0 && q > 0) return "ke kontrole";
  return "nahráno";
}

export async function listImportBatches(): Promise<ListImportBatchesResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return {
      ok: false,
      batches: [],
      reason: "not_configured",
      message:
        "Chybí NEXT_PUBLIC_SUPABASE_URL nebo SUPABASE_SERVICE_ROLE_KEY v .env.local.",
    };
  }

  const { data, error } = await supabase
    .from("imports")
    .select("id, source_type, source_url, note, created_at, batch_no")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return {
      ok: false,
      batches: [],
      reason: "error",
      message: error.message,
    };
  }

  const imports = (data ?? []) as ImportRow[];
  const ids = imports.map((x) => x.id).filter(Boolean);

  const [rawRes, qRes] = await Promise.all([
    ids.length
      ? supabase.from("offers_raw").select("import_id").in("import_id", ids).limit(5000)
      : Promise.resolve({ data: [], error: null } as any),
    ids.length
      ? supabase.from("offers_quarantine").select("import_id").in("import_id", ids).limit(5000)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (rawRes.error || qRes.error) {
    return {
      ok: false,
      batches: [],
      reason: "error",
      message: (rawRes.error?.message ?? qRes.error?.message ?? "Chyba při načítání počtů"),
    };
  }

  const rawCount = new Map<string, number>();
  for (const r of (rawRes.data ?? []) as any[]) {
    const id = String((r as any).import_id ?? "");
    if (!id) continue;
    rawCount.set(id, (rawCount.get(id) ?? 0) + 1);
  }
  const qCount = new Map<string, number>();
  for (const r of (qRes.data ?? []) as any[]) {
    const id = String((r as any).import_id ?? "");
    if (!id) continue;
    qCount.set(id, (qCount.get(id) ?? 0) + 1);
  }

  const batches: ImportBatchListItem[] = imports.map((b) => {
    const parsed = parseNote(b.note);
    const raw_count = rawCount.get(b.id) ?? 0;
    const quarantine_count = qCount.get(b.id) ?? 0;
    return {
      ...b,
      actor: parsed.actor,
      original_filename: parsed.file,
      raw_count,
      quarantine_count,
      item_count: raw_count + quarantine_count,
      status: deriveStatus({ raw_count, quarantine_count, note: b.note }),
    };
  });

  return { ok: true, batches };
}
