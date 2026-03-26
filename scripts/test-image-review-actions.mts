import assert from "node:assert/strict";
import { buildImageReviewPatch } from "../lib/product-types/image-review-actions.ts";

{
  const result = buildImageReviewPatch("approve", {
    approved_image_key: "butter",
    suggested_image_key: "cheese",
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected approve success");
  assert.equal(result.patch.approved_image_key, "butter");
  assert.equal(result.patch.image_review_status, "approved");
}

{
  const result = buildImageReviewPatch("reject", {
    approved_image_key: "butter",
    suggested_image_key: "cheese",
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected reject success");
  assert.equal(result.patch.approved_image_key, null);
  assert.equal(result.patch.image_review_status, "rejected");
}

{
  const result = buildImageReviewPatch("manual_override", {
    approved_image_key: null,
    suggested_image_key: null,
  }, "cheese");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected manual override success");
  assert.equal(result.patch.approved_image_key, "cheese");
  assert.equal(result.patch.image_review_status, "manual_override");
}

{
  const result = buildImageReviewPatch("manual_override", {
    approved_image_key: null,
    suggested_image_key: null,
  }, "brokolice-neexistuje");
  assert.equal(result.ok, false);
}

console.log("OK: image review action tests passed");

