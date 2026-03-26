import { isValidImageKey } from "./image-keys.ts";
import {
  IMAGE_MISSING_STATUS_MESSAGE,
  resolveBatchItemImageState,
  type BatchItemImageLike,
} from "./resolve-batch-item-image-state.ts";

export type ImageReviewAction = "approve" | "reject" | "manual_override";

export type ImageReviewPatch = {
  approved_image_key?: string | null;
  image_review_status: "approved" | "rejected" | "manual_override";
};

export function buildImageReviewPatch(
  action: ImageReviewAction,
  item: BatchItemImageLike,
  manualImageKey?: string | null
): { ok: true; patch: ImageReviewPatch } | { ok: false; error: string } {
  if (action === "reject") {
    return {
      ok: true,
      patch: {
        approved_image_key: null,
        image_review_status: "rejected",
      },
    };
  }

  if (action === "manual_override") {
    const candidate = (manualImageKey ?? "").trim();
    if (!isValidImageKey(candidate)) {
      return { ok: false, error: IMAGE_MISSING_STATUS_MESSAGE };
    }
    return {
      ok: true,
      patch: {
        approved_image_key: candidate,
        image_review_status: "manual_override",
      },
    };
  }

  const imageState = resolveBatchItemImageState(item);
  if (!imageState.hasValidImage || !imageState.resolvedImageKey) {
    return { ok: false, error: IMAGE_MISSING_STATUS_MESSAGE };
  }
  return {
    ok: true,
    patch: {
      approved_image_key: imageState.resolvedImageKey,
      image_review_status: "approved",
    },
  };
}

