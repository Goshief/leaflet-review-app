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

export function isValidImageKey(imageKey: string | null | undefined): boolean {
  if (typeof imageKey !== "string") return false;
  const s = imageKey.trim();
  if (!s) return false;
  if (AVAILABLE_IMAGE_KEY_SET.has(s)) return true;
  return STORAGE_OBJECT_KEY_RE.test(s);
}
