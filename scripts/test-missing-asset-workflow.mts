import assert from "node:assert/strict";
import { getMissingAssetWorkflowState } from "../lib/product-types/missing-asset-workflow.ts";
import {
  IMAGE_MISSING_STATUS_MESSAGE,
} from "../lib/product-types/resolve-batch-item-image-state.ts";

{
  const state = getMissingAssetWorkflowState(
    {
      resolvedImageKey: null,
      hasValidImage: false,
      imageMissing: true,
      imageStatusMessage: IMAGE_MISSING_STATUS_MESSAGE,
    },
    false
  );
  assert.equal(state.showMissingAssetCta, true);
  assert.equal(state.showGenerationRequested, false);
}

{
  const state = getMissingAssetWorkflowState(
    {
      resolvedImageKey: null,
      hasValidImage: false,
      imageMissing: true,
      imageStatusMessage: IMAGE_MISSING_STATUS_MESSAGE,
    },
    true
  );
  assert.equal(state.showMissingAssetCta, true);
  assert.equal(state.showGenerationRequested, true);
}

{
  const state = getMissingAssetWorkflowState(
    {
      resolvedImageKey: "butter",
      hasValidImage: true,
      imageMissing: false,
      imageStatusMessage: "Obrázek je připravený v Supabase Storage.",
    },
    true
  );
  assert.equal(state.showMissingAssetCta, false);
  assert.equal(state.showGenerationRequested, false);
}

console.log("OK: missing asset workflow tests passed");

