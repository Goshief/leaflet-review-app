"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { QuarantineListItem } from "@/lib/quarantine/list-quarantine";
import { parseQuarantineQuery } from "@/lib/quarantine/query";
import { FullProductCard } from "@/components/product/full-product-card";
import { quarantineListItemToFullCardVm } from "@/lib/quarantine/quarantine-product-card-vm";
import { isQuarantineRowOpenInDefaultList } from "@/lib/quarantine/quarantine-list-open";
import { getProductTypeImageUrl } from "@/lib/product-types";
import { resolveBatchItemImageState } from "@/lib/product-types/resolve-batch-item-image-state";

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("cs-CZ");
  } catch {
    return iso;
  }
}

type Action = "approve" | "reject" | "return";

export function QuarantineClient({
  items,
  dbCounts,
}: {
  items: QuarantineListItem[];
  /** Stejné dotazy jako přehled + `/api/stats` — po F5 konzistentní s KPI. */
  dbCounts?: { open: number; total: number } | null;
}) {
  const [q, setQ] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    try {
      const parsed = parseQuarantineQuery(window.location.search || "");
      if (parsed.q.trim()) setQ(parsed.q);
      setOnlyOpen(parsed.onlyOpen);
    } catch {
      // ignore
    }
  }, []);

  const selectedIds = useMemo(() => Object.keys(selected), [selected]);
  const selectedCount = selectedIds.length;

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return items.filter((x) => {
      if (onlyOpen && !isQuarantineRowOpenInDefaultList(x.quarantine_reason)) return false;
      if (!qq) return true;
      const hay = [
        x.extracted_name ?? "",
        x.store_id ?? "",
        x.source_type ?? "",
        x.quarantine_reason ?? "",
        x.actor ?? "",
        x.original_filename ?? "",
        x.import_id ?? "",
        x.batch?.batch_no != null ? String(x.batch.batch_no) : "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(qq);
    });
  }, [items, q, onlyOpen]);

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (on) next[id] = true;
      else delete next[id];
      return next;
    });
  };

  const bulk = async (action: Action) => {
    if (!selectedIds.length) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch("/api/quarantine/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: selectedIds }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; moved?: number };
      if (!res.ok || !data.ok) {
        setErr(data.error || `HTTP ${res.status}`);
        return;
      }
      setOk(
        action === "approve"
          ? `Schváleno a přesunuto do DB: ${data.moved ?? selectedIds.length}`
          : action === "reject"
            ? "Označeno jako zamítnuté"
            : "Označeno jako vráceno ke kontrole"
      );
      setSelected({});
    } catch {
      setErr("Síťová chyba.");
    } finally {
      setBusy(false);
    }
  };

  const runSingle = async (id: string, action: Action) => {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch("/api/quarantine/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: [id] }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; moved?: number };
      if (!res.ok || !data.ok) {
        setErr(data.error || `HTTP ${res.status}`);
        return;
      }
      setOk(
        action === "approve"
          ? `Schváleno a přesunuto do DB: ${data.moved ?? 1}`
          : action === "reject"
            ? "Označeno jako zamítnuté"
            : "Označeno jako vráceno ke kontrole"
      );
      setSelected({});
    } catch {
      setErr("Síťová chyba.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      className="mx-auto max-w-7xl space-y-6"
      data-testid="quarantine-db-page"
      aria-label="Databázová karanténa"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Karanténa (databáze)
          </h1>
          <p className="mt-2 text-slate-600">
            Globální seznam z tabulky <code className="rounded bg-slate-100 px-1 text-sm">offers_quarantine</code>{" "}
            (zdroj pravdy napříč dávkami).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/batches"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
          >
            Letáky →
          </Link>
          <Link
            href="/quarantine/local"
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-amber-100"
          >
            Lokální karanténa →
          </Link>
          <Link
            href="/history"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
          >
            Historie →
          </Link>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="grid gap-3 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-6">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Hledat (název / důvod / dávka / operátor)
            </label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="např. bez ceny, Lidl, #12…"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <div className="lg:col-span-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Zobrazení
            </label>
            <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={onlyOpen}
                onChange={(e) => setOnlyOpen(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600"
              />
              Jen otevřená karanténa
            </label>
          </div>
          <div className="lg:col-span-3 flex flex-col items-end justify-end gap-1 text-right">
            {dbCounts != null ? (
              <span
                className="max-w-full rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-900 ring-1 ring-indigo-200"
                data-testid="quarantine-db-counts"
                title="Shoda s přehledem (/) a totals v /api/stats"
              >
                DB: {dbCounts.open} otevř. · {dbCounts.total} celkem
              </span>
            ) : null}
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
              Výpis: {filtered.length} z {items.length} načtených
            </span>
          </div>
        </div>
      </div>

      {err ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-900">
          {err}
        </div>
      ) : null}
      {ok ? (
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-900">
          {ok}
        </div>
      ) : null}

      {selectedCount ? (
        <div className="sticky top-14 z-20 rounded-3xl border border-slate-200/80 bg-white/90 p-3 shadow-[0_10px_40px_rgba(15,23,42,0.10)] ring-1 ring-slate-100 backdrop-blur">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800 ring-1 ring-slate-200">
              Vybráno: {selectedCount}
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => bulk("approve")}
                className="rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                Schválit
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => bulk("reject")}
                className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
              >
                Zamítnout
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => bulk("return")}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Vrátit ke kontrole
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setSelected({})}
                className="text-sm font-semibold text-slate-600 hover:underline disabled:opacity-50"
              >
                Zrušit výběr
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
          <p className="text-sm font-semibold text-slate-900">
            Položky v karanténě
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {filtered.map((x) => {
            const vm = quarantineListItemToFullCardVm(x);
            const imageState = resolveBatchItemImageState({
              approved_image_key: x.approved_image_key,
              suggested_image_key: x.image_key,
            });
            const leftColumn = (
              <div className="flex gap-3 sm:flex-col sm:items-stretch">
                <input
                  type="checkbox"
                  checked={!!selected[x.id]}
                  onChange={(e) => toggle(x.id, e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500 sm:mx-auto sm:mt-0"
                  aria-label="Vybrat položku"
                />
                <div className="flex min-h-[88px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 sm:min-h-[120px]">
                  {imageState.hasValidImage ? (
                    <img
                      data-testid="quarantine-product-image-preview"
                      src={getProductTypeImageUrl(imageState.resolvedImageKey)}
                      alt=""
                      className="max-h-[120px] max-w-[132px] object-contain"
                    />
                  ) : vm.hasOcrThumb ? (
                    <span className="px-2 text-center text-[11px] font-medium leading-snug text-slate-500">
                      OCR výřez — v dávce u náhledu stránky
                    </span>
                  ) : (
                    <span className="px-2 text-center text-[11px] font-medium leading-snug text-slate-500">
                      Bez náhledu produktu
                    </span>
                  )}
                </div>
              </div>
            );
            return (
              <div key={x.id} className="space-y-3 px-4 py-5 sm:px-6">
                <FullProductCard
                  variant="quarantine"
                  vm={vm}
                  leftColumn={leftColumn}
                  rootTag="div"
                  rootTestId="quarantine-product-card"
                  actionsSlot={
                    <>
                      <Link
                        href={`/batches/${x.import_id}`}
                        className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-center text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                      >
                        Upravit
                      </Link>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runSingle(x.id, "approve")}
                        className="rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Schválit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runSingle(x.id, "return")}
                        className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                      >
                        Vrátit
                      </button>
                      <button
                        type="button"
                        disabled
                        title="Položka je již v karanténě"
                        className="cursor-not-allowed rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-400"
                      >
                        Karanténa
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runSingle(x.id, "reject")}
                        className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                      >
                        Zamítnout
                      </button>
                      <Link
                        href={`/batches/${x.import_id}`}
                        className="rounded-2xl border border-indigo-200 bg-indigo-50/80 px-3 py-2 text-center text-sm font-semibold text-indigo-900 shadow-sm hover:bg-indigo-100"
                      >
                        Otevřít dávku →
                      </Link>
                    </>
                  }
                />
                <p className="text-xs text-slate-500">
                  {x.store_id ?? x.source_type ?? "—"} · dávka{" "}
                  <span className="font-semibold text-slate-700">{x.batch?.batch_no ?? "—"}</span> · vytvořeno{" "}
                  {fmt(x.created_at)} · operátor: {x.actor ?? "—"}
                </p>
              </div>
            );
          })}
          {filtered.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              Nic k zobrazení (zkus upravit filtry).
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
