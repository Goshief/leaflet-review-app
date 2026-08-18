const DEFAULT_NEXT = "/upload";

/**
 * Allow only same-origin relative paths. Rejects open redirects such as
 * `https://attacker.example`, `//attacker.example`, or other-host URLs.
 */
export function resolveSafeNextPath(
  next: unknown,
  fallback: string = DEFAULT_NEXT
): string {
  if (typeof next !== "string") {
    return fallback;
  }

  const trimmed = next.trim();
  if (!trimmed) {
    return fallback;
  }

  // Must be a rooted relative path (not protocol-relative).
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return fallback;
  }

  // Reject any scheme-like segment before first slash of path content.
  if (trimmed.includes("://") || trimmed.includes("\\")) {
    return fallback;
  }

  try {
    const base = "http://local.invalid";
    const parsed = new URL(trimmed, base);
    if (parsed.origin !== base) {
      return fallback;
    }
    const safe = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return safe.startsWith("/") && !safe.startsWith("//") ? safe : fallback;
  } catch {
    return fallback;
  }
}

export const DEFAULT_POST_LOGIN_PATH = DEFAULT_NEXT;
