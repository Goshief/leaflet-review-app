"use client";

import { type FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const GENERIC_LOGIN_ERROR =
  "Přihlášení se nezdařilo. Zkontrolujte údaje a zkuste to znovu.";
const LOGIN_UNAVAILABLE_ERROR =
  "Přihlášení je dočasně nedostupné. Zkuste to prosím později.";
const LOGIN_TIMEOUT_MS = 15000;

type LoginFormProps = {
  nextPath: string;
};

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("login_timeout")),
          LOGIN_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function LoginForm({ nextPath }: LoginFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    if (!email || !password) {
      setError(GENERIC_LOGIN_ERROR);
      setPending(false);
      return;
    }

    try {
      const supabase = createClient();
      const { data, error: authError } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password })
      );

      if (authError || !data.session || !data.user) {
        setError(GENERIC_LOGIN_ERROR);
        return;
      }

      window.location.assign(nextPath || "/upload");
    } catch {
      setError(LOGIN_UNAVAILABLE_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
      <input type="hidden" name="next" value={nextPath} />

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          disabled={pending}
          className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/30 focus:border-indigo-500 focus:ring-2 disabled:opacity-60"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-700">
          Heslo
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-indigo-500/30 focus:border-indigo-500 focus:ring-2 disabled:opacity-60"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Přihlašuji…" : "Přihlásit"}
      </button>
    </form>
  );
}
