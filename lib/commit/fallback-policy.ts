export function isTruthyEnv(v: string | undefined): boolean {
  const x = (v ?? "").trim().toLowerCase();
  return x === "1" || x === "true" || x === "yes" || x === "on";
}

export function canUseNonTransactionalFallback(
  nodeEnv: string | undefined,
  allowFlag: string | undefined
): boolean {
  const isProduction = (nodeEnv ?? "").trim().toLowerCase() === "production";
  return !isProduction || isTruthyEnv(allowFlag);
}

