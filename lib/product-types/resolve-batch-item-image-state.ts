import { isValidImageKey } from "./image-keys.ts";

export const IMAGE_MISSING_STATUS_MESSAGE =
  "Produkt nemá obrázek v galerii. Nejdřív přidej nebo vygeneruj obrázek.";

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

export function resolveBatchItemImageState(item: BatchItemImageLike): BatchItemImageState {
  const approved = item.approved_image_key ?? null;
  const suggested = item.suggested_image_key ?? null;
  const resolved = approved || suggested || null;
  const valid = isValidImageKey(resolved);

  if (!valid) {
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
    imageStatusMessage: "Obrázek je připravený v galerii.",
  };
}

export function canBatchItemRunSaveAction(item: BatchItemImageLike): boolean {
  return resolveBatchItemImageState(item).hasValidImage;
}

