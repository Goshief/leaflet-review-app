import assert from "node:assert/strict";
import { getMissingAssetWorkflowState } from "../lib/product-types/missing-asset-workflow.ts";

{
  const state = getMissingAssetWorkflowState(
    {
      resolvedImageKey: null,
      hasValidImage: false,
      imageMissing: true,
      imageStatusMessage: "Produkt nemá obrázek v galerii. Nejdřív přidej nebo vygeneruj obrázek.",
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
      imageStatusMessage: "Produkt nemá obrázek v galerii. Nejdřív přidej nebo vygeneruj obrázek.",
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
      imageStatusMessage: "Obrázek je připravený v galerii.",
    },
    true
  );
  assert.equal(state.showMissingAssetCta, false);
  assert.equal(state.showGenerationRequested, false);
}

console.log("OK: missing asset workflow tests passed");

