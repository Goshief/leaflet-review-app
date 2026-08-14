"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPublicSupabaseEnv } from "@/lib/supabase/public-env";
import { signInWithPasswordFlow, GENERIC_LOGIN_ERROR } from "@/lib/auth/login";
import { signOutFlow } from "@/lib/auth/logout";

export type LoginActionState = {
  error: string | null;
};

export async function loginAction(
  _prev: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  if (!getPublicSupabaseEnv()) {
    return { error: GENERIC_LOGIN_ERROR };
  }

  let client;
  try {
    client = await createClient();
  } catch {
    return { error: GENERIC_LOGIN_ERROR };
  }

  const result = await signInWithPasswordFlow(client, {
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next"),
  });

  if (!result.ok) {
    return { error: result.error };
  }

  redirect(result.redirectTo);
}

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
