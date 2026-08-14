import type { Metadata } from "next";
import { LoginForm } from "@/app/login/login-form";
import { resolveSafeNextPath } from "@/lib/auth/safe-next-path";

export const metadata: Metadata = {
  title: "Přihlášení · Letáky Admin",
  robots: { index: false, follow: false },
};

/** Login mutations set cookies — never publicly cache this route. */
export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {};
  const rawNext = params.next;
  const nextValue = Array.isArray(rawNext) ? rawNext[0] : rawNext;
  const nextPath = resolveSafeNextPath(nextValue);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Přihlášení</h1>
        <p className="mt-2 text-sm text-slate-600">
          Přihlaste se účtem administrace Letáky Admin.
        </p>
        <LoginForm nextPath={nextPath} />
      </div>
    </div>
  );
}
