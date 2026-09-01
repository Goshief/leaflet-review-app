import type { AiChecks } from "./ai-checks.ts";
import { VERIFIED_PRODUCT_KEYS } from "./ai-checks.ts";

export type AiVerificationBadge = {
  kind: "confirmed" | "needs_review";
  text: string;
};

export function aiVerificationBadge(
  offer: { ai_checks?: AiChecks | null; review_status?: string | null },
): AiVerificationBadge {
  const checks = offer.ai_checks;
  if (offer.review_status === "needs_review") {
    return { kind: "needs_review", text: "AI ⚠ needs review" };
  }
  if (!checks) {
    return { kind: "needs_review", text: "AI ⚠ needs review" };
  }
  const unresolved = VERIFIED_PRODUCT_KEYS.some((key) => checks[key]?.status === "unresolved");
  if (unresolved) return { kind: "needs_review", text: "AI ⚠ needs review" };
  const triple = VERIFIED_PRODUCT_KEYS.filter((key) => checks[key]?.status === "confirmed" && checks[key]?.agreement === 3).length;
  if (triple === VERIFIED_PRODUCT_KEYS.length) {
    return { kind: "confirmed", text: "AI ✓ 3/3" };
  }
  return { kind: "needs_review", text: "AI ⚠ needs review" };
}
