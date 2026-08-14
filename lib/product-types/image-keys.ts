const AVAILABLE_IMAGE_KEYS = [
  "butter",
  "chocolate_bar",
  "drink_can",
  "cola_bottle",
  "alcohol_bottle",
  "cheese",
  "cream",
  "chicken_meat",
  "beer",
  "mandarins",
  "grapes",
  "placeholder",
] as const;

const AVAILABLE_IMAGE_KEY_SET = new Set<string>(AVAILABLE_IMAGE_KEYS);

export function getAvailableImageKeys(): string[] {
  return [...AVAILABLE_IMAGE_KEYS];
}

/** Filename-style keys uploaded to Supabase Storage bucket `product-types`. */
const STORAGE_OBJECT_KEY_RE = /^[a-z0-9][a-z0-9._-]*\.[a-z0-9]{2,12}$/i;

/** Known catalog slug (whitelist) — not a Storage existence proof. */
export function isKnownCatalogImageKey(imageKey: string | null | undefined): boolean {
  if (typeof imageKey !== "string") return false;
  const s = imageKey.trim();
  return s.length > 0 && AVAILABLE_IMAGE_KEY_SET.has(s);
}

/**
 * Syntactically valid Storage object key shape.
 * Does NOT mean the object exists in Storage or that an image is ready.
 */
export function isSyntacticStorageObjectKey(imageKey: string | null | undefined): boolean {
  if (typeof imageKey !== "string") return false;
  const s = imageKey.trim();
  return s.length > 0 && STORAGE_OBJECT_KEY_RE.test(s);
}

/**
 * Acceptable key shape for writes/overrides: catalog slug OR storage filename pattern.
 * Callers must not treat this alone as proof that a Storage object exists.
 */
export function isValidImageKey(imageKey: string | null | undefined): boolean {
  return isKnownCatalogImageKey(imageKey) || isSyntacticStorageObjectKey(imageKey);
}
