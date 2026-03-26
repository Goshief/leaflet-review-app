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

export function isValidImageKey(imageKey: string | null | undefined): boolean {
  if (typeof imageKey !== "string") return false;
  return AVAILABLE_IMAGE_KEY_SET.has(imageKey);
}

