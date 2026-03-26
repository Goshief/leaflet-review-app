"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { QuarantineListItem } from "@/lib/quarantine/list-quarantine";
import { parseQuarantineQuery } from "@/lib/quarantine/query";

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("cs-CZ");
  } catch {
    return iso;
  }
}

type Action = "approve" | "reject" | "return";

function prettyQuarantineReason(raw: string | null | undefined) {
  const src = (raw ?? "").toString().trim();
  if (!src) return "—";
  const labels: Record<string, string> = {
    missing_extracted_name: "chybí extracted_name",
    missing_price_total: "chybí price_total",
    bad_price_total: "price_total není číslo",
    bad_currency: "currency není CZK",
    missing_valid_to: "chybí valid_to",
  };
  if (src.startsWith("db_required_missing:")) {
    const list = src.slice("db_required_missing:".length).split(",").map((s) => s.trim()).filter(Boolean);
    if (!list.length) return "chybí povinná pole";
    return list.map((k) => labels[k] ?? k).join(" · ");
  }
  if (src === "db_required_missing") return "chybí povinná pole";
  if (src === "rejected_in_ui") return "zamítnuto v kontrole";
  if (src === "quarantine_in_ui") return "ručně přesunuto do karantény";
  return src;
}

export function QuarantineClient({ items }: { items: QuarantineListItem[] }) {
  const [q, setQ] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // URL-driven inicializace (Přehled -> Karanténa deep-link).
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
      if (onlyOpen) {
        const r = (x.quarantine_reason ?? "").toString().toLowerCase();
        if (r.startsWith("rejected_") || r.startsWith("returned_")) return false;
      }
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
      // Refresh bez složitého re-fetch: uživatel vidí změny po reloadu / nebo přes další iteraci.
      // (Necháváme to jednoduché – data jsou server-side.)
    } catch {
      setErr("Síťová chyba.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Karanténa
          </h1>
          <p className="mt-2 text-slate-600">
            Seznam karantény napříč dávkami (Supabase).
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
          <div className="lg:col-span-3 flex items-end justify-end">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
              Zobrazeno: {filtered.length} / {items.length}
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

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
          <p className="text-sm font-semibold text-slate-900">
            Položky v karanténě
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {filtered.map((x) => (
            <div key={x.id} className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 gap-3">
                <input
                  type="checkbox"
                  checked={!!selected[x.id]}
                  onChange={(e) => toggle(x.id, e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">
                    {x.extracted_name ?? "—"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {x.store_id ?? x.source_type ?? "—"} · dávka{" "}
                    <span className="font-semibold text-slate-700">
                      {x.batch?.batch_no ?? "—"}
                    </span>{" "}
                    · import <span className="font-mono">{x.import_id}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Důvod:{" "}
                    <span className="font-semibold text-slate-700">
                      {prettyQuarantineReason(x.quarantine_reason)}
                    </span>{" "}
                    · Operátor:{" "}
                    <span className="font-semibold text-slate-700">
                      {x.actor ?? "—"}
                    </span>{" "}
                    · {fmt(x.created_at)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSelected({ [x.id]: true });
                    void bulk("approve");
                  }}
                  className="rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  Schválit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSelected({ [x.id]: true });
                    void bulk("reject");
                  }}
                  className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                >
                  Zamítnout
                </button>
                <Link
                  href={`/batches/${x.import_id}`}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Otevřít dávku →
                </Link>
              </div>
            </div>
          ))}
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

