import type { BatchItemImageState } from "./resolve-batch-item-image-state.ts";

export const MISSING_ASSET_TITLE = "Chybí obrázek v úložišti";

export type MissingAssetWorkflowState = {
  showMissingAssetCta: boolean;
  showGenerationRequested: boolean;
  title: string;
  message: string;
};

export function getMissingAssetWorkflowState(
  imageState: BatchItemImageState,
  generationRequested: boolean
): MissingAssetWorkflowState {
  return {
    showMissingAssetCta: imageState.imageMissing,
    showGenerationRequested: imageState.imageMissing && generationRequested,
    title: MISSING_ASSET_TITLE,
    message: imageState.imageStatusMessage,
  };
}

