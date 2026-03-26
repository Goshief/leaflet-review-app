export type ReviewEmptyState = "no_data" | "filtered_out" | "has_data";

export function getReviewEmptyState(rawCount: number, visibleCount: number): ReviewEmptyState {
  if (rawCount <= 0) return "no_data";
  if (visibleCount <= 0) return "filtered_out";
  return "has_data";
}

