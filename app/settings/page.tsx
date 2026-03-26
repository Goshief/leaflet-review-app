export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Nastavení
        </h1>
        <p className="mt-2 text-slate-600">
          Zatím jednoduché místo pro konfiguraci aplikace (přibude později).
        </p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_8px_40px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
        <p className="text-sm text-slate-700">
          Sem dáme:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>defaultní store a výchozí zpracování</li>
          <li>operátora (prefill)</li>
          <li>napojení Supabase / Ollama</li>
          <li>logování a exporty</li>
        </ul>
      </div>
    </main>
  );
}

