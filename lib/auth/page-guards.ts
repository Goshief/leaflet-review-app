import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  evaluateAccess,
  resolveGuardClient,
  type GuardDeps,
} from "./guards";
import { getAuthenticatedActor, type AuthenticatedActor } from "./actor";
import {
  LEAFLET_PATHNAME_HEADER,
  resolveLoginNextPath,
} from "./request-path";

async function resolveNextPath(fallbackPath: string): Promise<string> {
  const h = await headers();
  return resolveLoginNextPath(h.get(LEAFLET_PATHNAME_HEADER), fallbackPath);
}

async function requirePageRole(
  need: "operator" | "admin",
  fallbackPath: string,
  deps?: GuardDeps
): Promise<AuthenticatedActor> {
  const safeNext = await resolveNextPath(fallbackPath);
  const client = await resolveGuardClient(deps);
  const actor = await getAuthenticatedActor(client);
  const result = evaluateAccess(actor, need);

  if (result.status === 401) {
    redirect(`/login?next=${encodeURIComponent(safeNext)}`);
  }
  if (result.status === 403 || !result.actor) {
    redirect("/forbidden");
  }
  return result.actor;
}

/** Server page/layout guard for operator-or-admin routes. */
export async function requireOperatorPage(
  fallbackPath: string,
  deps?: GuardDeps
): Promise<AuthenticatedActor> {
  return requirePageRole("operator", fallbackPath, deps);
}

/** Server page/layout guard for admin-only routes. */
export async function requireAdminPage(
  fallbackPath: string,
  deps?: GuardDeps
): Promise<AuthenticatedActor> {
  return requirePageRole("admin", fallbackPath, deps);
}
