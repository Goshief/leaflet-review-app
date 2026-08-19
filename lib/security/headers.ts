export const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
] as const;

export const PDF_VIEWER_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Content-Security-Policy",
    value: "default-src 'none'; frame-ancestors 'self'; sandbox allow-same-origin allow-scripts allow-forms allow-downloads",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
] as const;

type HeaderResponse = {
  headers: Headers;
};

/** Apply the same security contract to responses created outside Next config. */
export function applySecurityHeaders<T extends HeaderResponse>(response: T): T {
  for (const { key, value } of SECURITY_HEADERS) {
    response.headers.set(key, value);
  }
  return response;
}
