import {
  isBatchItemTable,
  sanitizeBatchItemPatch,
  type BatchItemEditablePatch,
  type BatchItemTable,
} from "./item-update.ts";
import {
  IMAGE_MISSING_STATUS_MESSAGE,
  resolveBatchItemImageState,
} from "../product-types/resolve-batch-item-image-state.ts";

export type PatchBody = {
  id?: string;
  import_id?: string;
  source_table?: BatchItemTable;
  patch?: BatchItemEditablePatch;
};

export type ParsedPatchRequest = {
  id: string;
  importId: string;
  sourceTable: BatchItemTable;
  patch: BatchItemEditablePatch;
};

type UpdateResultRow = Record<string, unknown>;

type UpdateResult = {
  data: UpdateResultRow | null;
  error: { message?: string } | null;
};

export type SupabaseUpdateClient = {
  /**
   * Structural typing wrapper around `@supabase/supabase-js` query builders.
   * Keep it permissive so App Routes can pass a real `SupabaseClient` without
   * fighting Postgrest builder generics during Next.js type-checking.
   */
  from(table: string): {
    select(columns: string): any;
    update(payload: Record<string, unknown>): any;
  };
};

type ExistingImageKeyRow = {
  approved_image_key?: string | null;
  suggested_image_key?: string | null;
  image_review_status?: string | null;
};

export function parsePatchBody(body: PatchBody): ParsedPatchRequest {
  const id = String(body.id ?? "").trim();
  const importId = String(body.import_id ?? "").trim();
  const sourceTable = body.source_table;

  if (!id || !importId || !isBatchItemTable(sourceTable)) {
    throw new Error(
      "Body musí obsahovat id, import_id a source_table (offers_raw | offers_quarantine)."
    );
  }

  const patch = sanitizeBatchItemPatch(body.patch);
  return { id, importId, sourceTable, patch };
}

export async function executePatchUpdate(
  supabase: SupabaseUpdateClient,
  request: ParsedPatchRequest
) {
  const existing = await supabase
    .from(request.sourceTable)
    .select("id, import_id, approved_image_key, suggested_image_key, image_review_status")
    .eq("id", request.id)
    .eq("import_id", request.importId)
    .maybeSingle();

  if (existing.error) {
    return { ok: false as const, status: 500, error: existing.error.message ?? "Load failed" };
  }
  if (!existing.data) {
    return {
      ok: false as const,
      status: 404,
      error: "Položka nebyla nalezena (zkontroluj id/import_id/source_table).",
    };
  }

  const existingImageKeys = existing.data as ExistingImageKeyRow;
  const imageState = resolveBatchItemImageState({
    approved_image_key:
      (request.patch.approved_image_key ?? existingImageKeys.approved_image_key) ?? null,
    suggested_image_key: existingImageKeys.suggested_image_key ?? null,
  });
  const nextImageReviewStatus =
    request.patch.image_review_status ?? existingImageKeys.image_review_status ?? null;
  const mustHaveValidImage =
    nextImageReviewStatus === "approved" || nextImageReviewStatus === "manual_override";
  if (mustHaveValidImage && !imageState.hasValidImage) {
    return {
      ok: false as const,
      status: 400,
      error: IMAGE_MISSING_STATUS_MESSAGE,
    };
  }

  const patchForUpdate: BatchItemEditablePatch = { ...request.patch };
  if (
    nextImageReviewStatus === "approved" &&
    imageState.hasValidImage &&
    imageState.resolvedImageKey
  ) {
    patchForUpdate.approved_image_key = imageState.resolvedImageKey;
  }

  const attemptUpdate = async (withUpdatedAt: boolean) => {
    const payload = withUpdatedAt
      ? { ...patchForUpdate, updated_at: new Date().toISOString() }
      : { ...patchForUpdate };
    return supabase
      .from(request.sourceTable)
      .update(payload)
      .eq("id", request.id)
      .eq("import_id", request.importId)
      .select(
        "id, import_id, extracted_name, price_total, currency, pack_qty, pack_unit, pack_unit_qty, price_standard, typical_price_per_unit, price_with_loyalty_card, has_loyalty_card_price, notes, brand, category, valid_from, valid_to, created_at, suggested_image_key, approved_image_key, image_review_status"
      )
      .maybeSingle();
  };

  let result = await attemptUpdate(true);
  if (result.error && /updated_at/i.test(result.error.message ?? "")) {
    result = await attemptUpdate(false);
  }

  if (result.error) {
    return { ok: false as const, status: 500, error: result.error.message ?? "Update failed" };
  }
  if (!result.data) {
    return {
      ok: false as const,
      status: 404,
      error: "Položka nebyla nalezena (zkontroluj id/import_id/source_table).",
    };
  }

  return {
    ok: true as const,
    status: 200,
    item: {
      ...result.data,
      source_table: request.sourceTable,
    },
    updatedFields: Object.keys(patchForUpdate),
  };
}
