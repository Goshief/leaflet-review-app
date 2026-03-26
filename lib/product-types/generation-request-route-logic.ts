export type GenerationRequestStatus = "pending" | "processing" | "done" | "error";

export type GenerationRequestBody = {
  batchItemId?: string;
  importId?: string;
  sourceTable?: "offers_raw" | "offers_quarantine";
  productName?: string | null;
  candidateImageKey?: string | null;
  source?: string;
};

export type ParsedGenerationRequest = {
  batchItemId: string;
  importId: string;
  sourceTable: "offers_raw" | "offers_quarantine";
  productName: string | null;
  candidateImageKey: string | null;
  source: "leaflet-review-app";
};

export type GenerationRequestUpdateBody = {
  id?: string;
  status?: GenerationRequestStatus;
  resolvedImageKey?: string | null;
  errorNote?: string | null;
  applyToBatchItem?: boolean;
};

export type ParsedGenerationRequestUpdate = {
  id: string;
  status: GenerationRequestStatus;
  resolvedImageKey: string | null;
  errorNote: string | null;
  applyToBatchItem: boolean;
};

type QueryResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

type InsertResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

type RequestRow = {
  id: string;
  batch_item_id: string;
  import_id: string;
  source_table: "offers_raw" | "offers_quarantine";
  product_name: string | null;
  candidate_image_key: string | null;
  source: string;
  status: GenerationRequestStatus;
  resolved_image_key: string | null;
  error_note: string | null;
  created_at: string;
  updated_at?: string;
};

type QueryBuilder<T> = {
  eq(column: string, value: string): QueryBuilder<T>;
  order(column: string, options: { ascending: boolean }): QueryBuilder<T>;
  limit(value: number): QueryBuilder<T>;
  maybeSingle(): PromiseLike<QueryResult<T>>;
  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2>;
};

type InsertBuilder<T> = {
  select(columns: string): { maybeSingle(): PromiseLike<InsertResult<T>> };
};

export type SupabaseGenerationRequestClient = {
  from(table: string): {
    select(columns: string): QueryBuilder<RequestRow>;
    insert(payload: Record<string, unknown>): InsertBuilder<RequestRow>;
    update(payload: Record<string, unknown>): {
      eq(column: string, value: string): QueryBuilder<RequestRow>;
    };
  };
};

export const GENERATION_REQUEST_MISSING_MESSAGE =
  "Nepodařilo se uložit požadavek na generování obrázku.";
export const GENERATION_REQUEST_UPDATE_MISSING_MESSAGE =
  "Nepodařilo se uložit změnu stavu požadavku.";

const VALID_TRANSITIONS: Record<GenerationRequestStatus, GenerationRequestStatus[]> = {
  pending: ["processing", "error"],
  processing: ["done", "error"],
  done: [],
  error: [],
};

export function parseGenerationRequestBody(
  body: GenerationRequestBody
): ParsedGenerationRequest {
  const batchItemId = String(body.batchItemId ?? "").trim();
  const importId = String(body.importId ?? "").trim();
  const sourceTable = body.sourceTable;
  const source = String(body.source ?? "").trim();
  const productName = body.productName == null ? null : String(body.productName).trim() || null;
  const candidateImageKey =
    body.candidateImageKey == null ? null : String(body.candidateImageKey).trim() || null;

  if (!batchItemId || !importId) {
    throw new Error("batchItemId a importId jsou povinné.");
  }
  if (sourceTable !== "offers_raw" && sourceTable !== "offers_quarantine") {
    throw new Error("sourceTable musí být offers_raw nebo offers_quarantine.");
  }
  if (source !== "leaflet-review-app") {
    throw new Error("source musí být leaflet-review-app.");
  }

  return {
    batchItemId,
    importId,
    sourceTable,
    productName,
    candidateImageKey,
    source: "leaflet-review-app",
  };
}

export function parseGenerationRequestUpdateBody(
  body: GenerationRequestUpdateBody
): ParsedGenerationRequestUpdate {
  const id = String(body.id ?? "").trim();
  const status = body.status;
  const resolvedImageKey =
    body.resolvedImageKey == null ? null : String(body.resolvedImageKey).trim() || null;
  const errorNote = body.errorNote == null ? null : String(body.errorNote).trim() || null;
  const applyToBatchItem = body.applyToBatchItem === true;

  if (!id) throw new Error("id je povinné.");
  if (!status || !["pending", "processing", "done", "error"].includes(status)) {
    throw new Error("status musí být pending|processing|done|error.");
  }

  return { id, status, resolvedImageKey, errorNote, applyToBatchItem };
}

function canTransition(from: GenerationRequestStatus, to: GenerationRequestStatus) {
  return VALID_TRANSITIONS[from]?.includes(to) === true;
}

export async function listGenerationRequests(
  supabase: SupabaseGenerationRequestClient,
  limit = 200
) {
  const result = await supabase
    .from("product_type_generation_requests")
    .select(
      "id, batch_item_id, import_id, source_table, product_name, candidate_image_key, source, status, resolved_image_key, error_note, created_at, updated_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (result.error) {
    return {
      ok: false as const,
      status: 500,
      error: result.error.message ?? GENERATION_REQUEST_MISSING_MESSAGE,
    };
  }

  return { ok: true as const, requests: (result.data ?? []) as RequestRow[] };
}

export async function createOrReuseGenerationRequest(
  supabase: SupabaseGenerationRequestClient,
  req: ParsedGenerationRequest
) {
  const existing = await supabase
    .from("product_type_generation_requests")
    .select(
      "id, batch_item_id, import_id, source_table, product_name, candidate_image_key, source, status, resolved_image_key, error_note, created_at, updated_at"
    )
    .eq("batch_item_id", req.batchItemId)
    .eq("import_id", req.importId)
    .eq("source_table", req.sourceTable)
    .eq("source", req.source)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);

  if (existing.error) {
    return { ok: false as const, status: 500, error: existing.error.message ?? GENERATION_REQUEST_MISSING_MESSAGE };
  }
  const existingList = (existing.data as unknown as RequestRow[] | null) ?? null;
  if (existingList && existingList.length > 0) {
    return { ok: true as const, created: false, request: existingList[0] };
  }

  const inserted = await supabase
    .from("product_type_generation_requests")
    .insert({
      batch_item_id: req.batchItemId,
      import_id: req.importId,
      source_table: req.sourceTable,
      product_name: req.productName,
      candidate_image_key: req.candidateImageKey,
      source: req.source,
      status: "pending",
    })
    .select(
      "id, batch_item_id, import_id, source_table, product_name, candidate_image_key, source, status, resolved_image_key, error_note, created_at, updated_at"
    )
    .maybeSingle();

  if (inserted.error || !inserted.data) {
    return {
      ok: false as const,
      status: 500,
      error: inserted.error?.message ?? GENERATION_REQUEST_MISSING_MESSAGE,
    };
  }

  return { ok: true as const, created: true, request: inserted.data };
}

export async function updateGenerationRequestLifecycle(
  supabase: SupabaseGenerationRequestClient,
  update: ParsedGenerationRequestUpdate,
  opts: {
    isValidImageKey: (key: string | null | undefined) => boolean;
  }
) {
  const current = await supabase
    .from("product_type_generation_requests")
    .select(
      "id, batch_item_id, import_id, source_table, product_name, candidate_image_key, source, status, resolved_image_key, error_note, created_at, updated_at"
    )
    .eq("id", update.id)
    .maybeSingle();

  if (current.error) {
    return { ok: false as const, status: 500, error: current.error.message ?? GENERATION_REQUEST_UPDATE_MISSING_MESSAGE };
  }
  if (!current.data) {
    return { ok: false as const, status: 404, error: "Požadavek nebyl nalezen." };
  }

  const row = current.data as RequestRow;
  if (!canTransition(row.status, update.status)) {
    return {
      ok: false as const,
      status: 400,
      error: `Neplatný přechod stavu: ${row.status} -> ${update.status}`,
    };
  }

  if (update.status === "done" && update.resolvedImageKey && !opts.isValidImageKey(update.resolvedImageKey)) {
    return {
      ok: false as const,
      status: 400,
      error: "Finální image key není validní pro galerii.",
    };
  }

  const nextPayload: Record<string, unknown> = {
    status: update.status,
    resolved_image_key: update.status === "done" ? update.resolvedImageKey : row.resolved_image_key,
    error_note: update.status === "error" ? update.errorNote : null,
  };

  const saved = await supabase
    .from("product_type_generation_requests")
    .update(nextPayload)
    .eq("id", update.id)
    .select(
      "id, batch_item_id, import_id, source_table, product_name, candidate_image_key, source, status, resolved_image_key, error_note, created_at, updated_at"
    )
    .maybeSingle();

  if (saved.error || !saved.data) {
    return {
      ok: false as const,
      status: 500,
      error: saved.error?.message ?? GENERATION_REQUEST_UPDATE_MISSING_MESSAGE,
    };
  }

  // Optional auto-propagation when operator marks request as done and has final key.
  if (update.status === "done" && update.applyToBatchItem && update.resolvedImageKey) {
    const batchUpdate = await supabase
      .from(row.source_table)
      .update({
        approved_image_key: update.resolvedImageKey,
        image_review_status: "manual_override",
      })
      .eq("id", row.batch_item_id)
      .eq("import_id", row.import_id)
      .maybeSingle();

    if (batchUpdate.error) {
      return {
        ok: false as const,
        status: 500,
        error: `Request uložen, ale nepodařilo se propsat batch item: ${batchUpdate.error.message ?? "update failed"}`,
      };
    }
  }

  return { ok: true as const, request: saved.data as RequestRow };
}

