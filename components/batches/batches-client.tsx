"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ImportBatchListItem } from "@/lib/data/import-batches";

type CommitLogEntry = {
  import_id?: string | null;
  batch_id?: string | null;
  session_key?: string | null;
  committed_at?: string;
};

type ReviewStateEntry = {
  updated_at?: string;
};

function safeParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("cs-CZ");
  } catch {
    return iso;
  }
}

function statusBadge(status: ImportBatchListItem["status"]) {
  const cls =
    status === "importováno"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200/70"
      : status === "částečně schváleno"
        ? "bg-amber-50 text-amber-950 ring-amber-200/70"
        : status === "ke kontrole"
          ? "bg-indigo-50 text-indigo-800 ring-indigo-200/70"
          : status === "chyba"
            ? "bg-rose-50 text-rose-800 ring-rose-200/70"
            : status === "rozpracováno"
              ? "bg-slate-100 text-slate-700 ring-slate-200"
              : "bg-slate-50 text-slate-700 ring-slate-200";
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${cls}`}>
      {status}
    </span>
  );
}

export function BatchesClient({ batches }: { batches: ImportBatchListItem[] }) {
  const router = useRouter();
  const [commitLog, setCommitLog] = useState<CommitLogEntry[]>([]);

  useEffect(() => {
    const refresh = () => {
      const parsed = safeParse<CommitLogEntry[]>(localStorage.getItem("leaflet_commit_log"));
      setCommitLog(Array.isArray(parsed) ? parsed : []);
    };
    refresh();
    const t = window.setInterval(refresh, 2000);
    return () => window.clearInterval(t);
  }, []);

  const continueHrefByImport = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of commitLog) {
      const importId = (e.import_id ?? e.batch_id ?? "")?.toString().trim();
      const sessionKey = (e.session_key ?? "")?.toString().trim();
      if (!importId || !sessionKey) continue;
      // Ověř, že session existuje (jinak fallback).
      const st = safeParse<ReviewStateEntry>(localStorage.getItem(`leaflet_review_state:${sessionKey}`));
      if (!st) continue;
      map.set(importId, `/review?resume_key=${encodeURIComponent(sessionKey)}`);
    }
    return map;
  }, [commitLog]);

  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {batches.map((b) => {
        const continueHref = continueHrefByImport.get(b.id) ?? "/review";
        return (
          <article
            key={b.id}
            className="flex flex-col rounded-3xl border border-slate-200/90 bg-white p-6 shadow-[0_8px_40px_rgba(15,23,42,0.06)] ring-1 ring-slate-100 transition hover:shadow-lg"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-slate-900">
                  {b.source_type}
                </h2>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {b.original_filename ?? "—"}
                </p>
              </div>
              {statusBadge(b.status)}
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <dt className="text-xs text-slate-500">Datum nahrání</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                  {fmtDateTime(b.created_at)}
                </dd>
              </div>
              <div className="rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <dt className="text-xs text-slate-500">Počet položek</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                  {b.item_count}
                </dd>
              </div>
              <div className="rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <dt className="text-xs text-slate-500">Kdo ji zpracoval</dt>
                <dd className="mt-1 truncate text-sm font-semibold text-slate-900">
                  {b.actor ?? "—"}
                </dd>
              </div>
              <div className="rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                <dt className="text-xs text-slate-500">Import #</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                  {b.batch_no}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-slate-600">
              Detail obsahuje seznam portovaných produktů (
              <span className="font-medium text-slate-800">
                raw {b.raw_count}
              </span>
              {" / "}
              <span className="font-medium text-slate-800">
                quarantine {b.quarantine_count}
              </span>
              ).
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href={`/batches/${b.id}`}
                onClick={() => {
                  try {
                    localStorage.setItem(
                      "leaflet_last_batch",
                      JSON.stringify({ import_id: b.id, at: new Date().toISOString() })
                    );
                  } catch {
                    // ignore
                  }
                }}
                className="inline-flex items-center justify-center rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:bg-indigo-700"
              >
                Otevřít →
              </Link>
              <Link
                href={continueHref}
                onClick={() => {
                  try {
                    localStorage.setItem(
                      "leaflet_last_batch",
                      JSON.stringify({ import_id: b.id, at: new Date().toISOString() })
                    );
                  } catch {
                    // ignore
                  }
                }}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
              >
                Pokračovat →
              </Link>
              <Link
                href="/history"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
              >
                Zobrazit historii →
              </Link>
              <button
                type="button"
                onClick={() => {
                  try {
                    sessionStorage.setItem(
                      "leaflet_upload_prefill",
                      JSON.stringify({
                        retailer: b.source_type ?? "lidl",
                        sourceUrl: b.source_url ?? "",
                      })
                    );
                  } catch {
                    // ignore
                  }
                  router.push("/upload");
                }}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
              >
                Duplikovat
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

