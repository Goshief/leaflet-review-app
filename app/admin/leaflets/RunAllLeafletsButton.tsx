"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const RETAILERS = ["albert", "billa", "dm", "globus", "kaufland", "kosik", "lidl", "penny", "rohlik", "rossmann", "tesco", "teta"] as const;

export function RunAllLeafletsButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function runAll() {
    setRunning(true);
    setMessage("Spouštím 0/12…");
    let ok = 0;
    let failed = 0;

    for (let i = 0; i < RETAILERS.length; i++) {
      const retailer = RETAILERS[i];
      setMessage(`Spouštím ${i + 1}/12: ${retailer}…`);
      try {
        const response = await fetch(`/api/admin/leaflets/run?retailer=${encodeURIComponent(retailer)}`, {
          method: "POST",
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
        if (!response.ok || !payload?.ok) failed++;
        else ok++;
      } catch {
        failed++;
      }
    }

    setMessage(`Hotovo: ${ok}/12 OK, ${failed} chyba`);
    setRunning(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={runAll}
        disabled={running}
        className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white shadow-sm disabled:cursor-wait disabled:opacity-60"
      >
        {running ? "Kontroluji všech 12…" : "Spustit kontrolu všech 12"}
      </button>
      {message ? <span className="text-xs font-semibold text-slate-600">{message}</span> : null}
    </div>
  );
}
