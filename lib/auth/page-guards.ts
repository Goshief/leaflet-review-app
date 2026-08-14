import { redirect } from "next/navigation";
import {
  evaluateAccess,
  resolveGuardClient,
  type GuardDeps,
} from "./guards";
import { getAuthenticatedActor, type AuthenticatedActor } from "./actor";
import { resolveSafeNextPath } from "./safe-next-path";

async function requirePageRole(
  need: "operator" | "admin",
  nextPath: string,
  deps?: GuardDeps
): Promise<AuthenticatedActor> {
  const safeNext = resolveSafeNextPath(nextPath, "/");
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
  nextPath: string,
  deps?: GuardDeps
): Promise<AuthenticatedActor> {
  return requirePageRole("operator", nextPath, deps);
}

/** Server page/layout guard for admin-only routes. */
export async function requireAdminPage(
  nextPath: string,
  deps?: GuardDeps
): Promise<AuthenticatedActor> {
  return requirePageRole("admin", nextPath, deps);
}
