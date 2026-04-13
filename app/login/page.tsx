"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const sp = useSearchParams();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) {
        setErr(j?.error ?? "Přihlášení selhalo.");
        return;
      }
      const next = sp.get("next") || "/";
      router.push(next);
      router.refresh();
    } catch {
      setErr("Přihlášení selhalo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-2xl font-semibold">Přihlášení administrátora</h1>
      <form onSubmit={onSubmit} className="space-y-3 rounded-xl border bg-white p-4">
        <label className="block text-sm">
          Email
          <input className="mt-1 w-full rounded border p-2" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm">
          Heslo
          <input
            type="password"
            className="mt-1 w-full rounded border p-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {err ? <p className="text-sm text-rose-600">{err}</p> : null}
        <button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-white">
          {busy ? "Přihlašuji…" : "Přihlásit"}
        </button>
      </form>
    </main>
  );
}
