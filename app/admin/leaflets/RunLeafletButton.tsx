"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunLeafletButton({ retailer }: { retailer: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/leaflets/run?retailer=${encodeURIComponent(retailer)}`, {
        method: "POST",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error ?? `HTTP ${response.status}`));
      }
      const found = Number(payload.found_leaflets_count ?? 0);
      const fresh = Number(payload.new_leaflets_count ?? 0);
      setMessage(`Hotovo: nalezeno ${found}, nových ${fresh}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Spuštění selhalo");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex min-w-40 flex-col gap-1">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:cursor-wait disabled:opacity-60"
      >
        {running ? "Spouštím…" : "Spustit teď"}
      </button>
      {message ? <span className="max-w-48 text-[11px] leading-4 text-slate-600">{message}</span> : null}
    </div>
  );
}
