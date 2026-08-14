import { isKnownCatalogImageKey } from "./image-keys.ts";

export const IMAGE_MISSING_STATUS_MESSAGE =
  "Produkt nemá platný image key. V sekci „Image review akce“ vyber katalogový key a ulož ho přes „Manual override“ (uloží se do databáze).";

export type BatchItemImageLike = {
  approved_image_key?: string | null;
  suggested_image_key?: string | null;
};

export type BatchItemImageState = {
  resolvedImageKey: string | null;
  hasValidImage: boolean;
  imageMissing: boolean;
  imageStatusMessage: string;
};

/**
 * UI/server readiness for a batch item image.
 *
 * - Known catalog key → treated as ready for save/approve flows in this phase.
 * - Syntactically valid Storage filename alone is NOT enough (no Storage probe here).
 * - Verified Storage object existence is out of scope for this helper.
 */
export function resolveBatchItemImageState(item: BatchItemImageLike): BatchItemImageState {
  const approved = item.approved_image_key ?? null;
  const suggested = item.suggested_image_key ?? null;
  const resolved = approved || suggested || null;

  // Catalog membership only — syntactic Storage keys must not claim readiness.
  if (!isKnownCatalogImageKey(resolved)) {
    return {
      resolvedImageKey: null,
      hasValidImage: false,
      imageMissing: true,
      imageStatusMessage: IMAGE_MISSING_STATUS_MESSAGE,
    };
  }

  return {
    resolvedImageKey: resolved,
    hasValidImage: true,
    imageMissing: false,
    imageStatusMessage: "Obrázek je připravený v Supabase Storage.",
  };
}

export function canBatchItemRunSaveAction(item: BatchItemImageLike): boolean {
  return resolveBatchItemImageState(item).hasValidImage;
}
