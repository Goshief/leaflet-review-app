export type SameOriginCheck =
  | { ok: true }
  | { ok: false; reason: "cross_site" | "missing_proof" | "invalid_origin" };

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * CSRF guard for state-changing route handlers.
 *
 * Modern browsers send both Origin and Sec-Fetch-Site. Older clients may send
 * only one, so at least one positive same-origin signal is required and any
 * contradictory signal rejects the request.
 */
export function requireSameOrigin(request: Pick<Request, "headers" | "url">): SameOriginCheck {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase() ?? null;
  if (fetchSite && fetchSite !== "same-origin") {
    return { ok: false, reason: "cross_site" };
  }

  const expectedOrigin = normalizedOrigin(request.url);
  const suppliedOrigin = request.headers.get("origin")?.trim() ?? null;

  if (suppliedOrigin) {
    const origin = normalizedOrigin(suppliedOrigin);
    if (!origin) return { ok: false, reason: "invalid_origin" };
    if (!expectedOrigin || origin !== expectedOrigin) {
      return { ok: false, reason: "cross_site" };
    }
    return { ok: true };
  }

  if (fetchSite === "same-origin") return { ok: true };
  return { ok: false, reason: "missing_proof" };
}
