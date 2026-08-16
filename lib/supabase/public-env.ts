/**
 * Public (browser-safe) Supabase Auth configuration.
 * Never reads the service-role secret.
 */

export type PublicSupabaseEnv = {
  url: string;
  publishableKey: string;
};

type EnvLike = Record<string, string | undefined>;

export function getPublicSupabaseEnv(env: EnvLike = process.env): PublicSupabaseEnv | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "";

  if (!url || !publishableKey) {
    return null;
  }

  return { url, publishableKey };
}

export function assertPublicSupabaseEnv(env: EnvLike = process.env): PublicSupabaseEnv {
  const resolved = getPublicSupabaseEnv(env);
  if (!resolved) {
    throw new Error("Supabase Auth není nakonfigurovaný (chybí URL nebo publishable key).");
  }
  return resolved;
}
