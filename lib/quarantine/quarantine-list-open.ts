/** Completed review states are hidden by the default "open only" filter. */
export function isQuarantineRowOpenInDefaultList(
  reason: string | null | undefined
): boolean {
  const normalized = (reason ?? "").trim().toLowerCase();
  return !normalized.startsWith("rejected_") && !normalized.startsWith("returned_");
}
