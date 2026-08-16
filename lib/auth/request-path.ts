import { resolveSafeNextPath } from "./safe-next-path.ts";

/** Forwarded by proxy.ts so page guards can restore deep links after login. */
export const LEAFLET_PATHNAME_HEADER = "x-leaflet-pathname";

/**
 * Prefer the live request path (from Proxy) over a section fallback such as `/batches`.
 * Always returns a safe internal path.
 */
export function resolveLoginNextPath(
  requestedPath: string | null | undefined,
  fallbackPath: string
): string {
  const safeFallback = resolveSafeNextPath(fallbackPath, "/");
  if (requestedPath == null || requestedPath === "") {
    return safeFallback;
  }
  return resolveSafeNextPath(requestedPath, safeFallback);
}
