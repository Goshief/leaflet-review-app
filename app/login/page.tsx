"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/admin/leaflets";
      router.replace(target);
      router.refresh();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Přihlášení selhalo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-10">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">Letáky Admin</p>
        <h1 className="mt-2 text-2xl font-black text-slate-950">Přihlášení do administrace</h1>
        <p className="mt-2 text-sm text-slate-600">Po přihlášení se otevře centrální dashboard 12 crawlerů.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-semibold text-slate-700">
            E-mail
            <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500" />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Heslo
            <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500" />
          </label>
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-slate-900 px-4 py-2.5 font-bold text-white disabled:cursor-wait disabled:opacity-60">
            {loading ? "Přihlašuji…" : "Přihlásit"}
          </button>
        </form>
      </div>
    </main>
  );
}
