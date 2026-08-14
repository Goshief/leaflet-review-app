/**
 * Trusted operator roles for Letáky Admin.
 *
 * Contract (managed outside this app, typically via Supabase Auth Admin API
 * or Dashboard — never by end users):
 *
 *   app_metadata: { role: "operator" | "admin" }
 *
 * - `operator` — ordinary administration workflows (guards land in point 04).
 * - `admin` — includes operator rights plus privileged settings later.
 *
 * Authorization source is ONLY Supabase `app_metadata.role`.
 * `user_metadata` / `raw_user_meta_data` is user-editable and MUST NOT grant access.
 * JWT claims embedding app_metadata can be stale until refresh; privileged
 * helpers re-read the Auth user via `getUser()` for the current role.
 * Typos, wrong casing, arrays, and unknown values are rejected (fail-closed).
 */

export const OPERATOR_ROLES = ["operator", "admin"] as const;

export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export function isOperatorRole(value: unknown): value is OperatorRole {
  return value === "operator" || value === "admin";
}

/**
 * Strict parser for `app_metadata`. Returns null for any missing, empty,
 * mistyped, or unknown value. Does not inspect `user_metadata`.
 */
export function parseOperatorRole(appMetadata: unknown): OperatorRole | null {
  if (appMetadata == null || typeof appMetadata !== "object" || Array.isArray(appMetadata)) {
    return null;
  }

  const role = (appMetadata as Record<string, unknown>).role;
  if (!isOperatorRole(role)) {
    return null;
  }

  return role;
}

/** Ordinary admin workflows: operator or admin. */
export function roleAllowsOperatorAccess(role: OperatorRole): boolean {
  return role === "operator" || role === "admin";
}

/** Privileged settings: admin only. */
export function roleAllowsAdminAccess(role: OperatorRole): boolean {
  return role === "admin";
}
