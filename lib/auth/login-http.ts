import { NextResponse } from "next/server.js";
import { applySecurityHeaders } from "../security/headers.ts";

const LOGIN_CACHE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const;

export function loginJsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers?: HeadersInit
): NextResponse {
  const response = NextResponse.json(body, {
    status,
    headers: LOGIN_CACHE_HEADERS,
  });

  if (headers) {
    new Headers(headers).forEach((value, key) => response.headers.set(key, value));
  }

  return applySecurityHeaders(response);
}
