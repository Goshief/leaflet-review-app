"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/public-env";
import { signOutFlow } from "@/lib/auth/logout";

export async function logoutAction(): Promise<void> {
  if (!getPublicSupabaseEnv()) {
    redirect("/login");
  }

  try {
    const client = await createClient();
    await signOutFlow(client);
  } catch {
    // Already signed out / misconfigured — still land on login.
  }

  redirect("/login");
}
