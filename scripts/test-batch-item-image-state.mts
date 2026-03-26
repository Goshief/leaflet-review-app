import assert from "node:assert/strict";
import {
  IMAGE_MISSING_STATUS_MESSAGE,
  canBatchItemRunSaveAction,
  resolveBatchItemImageState,
} from "../lib/product-types/resolve-batch-item-image-state.ts";

{
  const state = resolveBatchItemImageState({
    approved_image_key: "butter",
    suggested_image_key: "cheese",
  });
  assert.equal(state.resolvedImageKey, "butter");
  assert.equal(state.hasValidImage, true);
  assert.equal(state.imageMissing, false);
  assert.equal(canBatchItemRunSaveAction({ approved_image_key: "butter" }), true);
}

{
  const state = resolveBatchItemImageState({
    approved_image_key: null,
    suggested_image_key: "cheese",
  });
  assert.equal(state.resolvedImageKey, "cheese");
  assert.equal(state.hasValidImage, true);
  assert.equal(state.imageMissing, false);
  assert.equal(canBatchItemRunSaveAction({ suggested_image_key: "cheese" }), true);
}

{
  const state = resolveBatchItemImageState({
    approved_image_key: "brokolice-neexistuje",
    suggested_image_key: null,
  });
  assert.equal(state.resolvedImageKey, null);
  assert.equal(state.hasValidImage, false);
  assert.equal(state.imageMissing, true);
  assert.equal(state.imageStatusMessage, IMAGE_MISSING_STATUS_MESSAGE);
  assert.equal(
    canBatchItemRunSaveAction({ approved_image_key: "brokolice-neexistuje" }),
    false
  );
}

{
  const state = resolveBatchItemImageState({
    approved_image_key: null,
    suggested_image_key: null,
  });
  assert.equal(state.resolvedImageKey, null);
  assert.equal(state.hasValidImage, false);
  assert.equal(state.imageMissing, true);
  assert.equal(state.imageStatusMessage, IMAGE_MISSING_STATUS_MESSAGE);
  assert.equal(canBatchItemRunSaveAction({}), false);
}

console.log("OK: batch item image state tests passed");

