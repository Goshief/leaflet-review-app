"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { RowReviewStatus } from "@/components/review/product-cards";
import { reviewQuarantineHref } from "@/lib/nav/quarantine";

type ReviewOfferRow = any;
type ReviewStateEntry = {
  offers?: ReviewOfferRow[]; // legacy
  rowStatus?: Record<number, RowReviewStatus | undefined>; // legacy
  offersByPage?: Record<string, ReviewOfferRow[]>;
  rowStatusByPage?: Record<string, Record<number, RowReviewStatus | undefined>>;
  rowReasonByPage?: Record<string, Record<number, any>>;
  updated_at?: string;
  resume_url?: string | null;
};

function safeParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function LocalQuarantine() {
  const [sessions, setSessions] = useState<Array<{ key: string; state: ReviewStateEntry }>>([]);

  useEffect(() => {
    const refresh = () => {
      try {
        const out: Array<{ key: string; state: ReviewStateEntry }> = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i) ?? "";
          if (!k.startsWith("leaflet_review_state:")) continue;
          const st = safeParse<ReviewStateEntry>(localStorage.getItem(k));
          const legacyOk = st && Array.isArray(st.offers);
          const byPageOk = st && st.offersByPage && typeof st.offersByPage === "object";
          if (legacyOk || byPageOk) out.push({ key: k, state: st! });
        }
        out.sort((a, b) => String(b.state.updated_at ?? "").localeCompare(String(a.state.updated_at ?? "")));
        setSessions(out.slice(0, 50));
      } catch {
        setSessions([]);
      }
    };
    refresh();
    const t = window.setInterval(refresh, 2000);
    return () => window.clearInterval(t);
  }, []);

  const localItems = useMemo(() => {
    const items: Array<{
      sessionKey: string;
      resumeHref: string;
      extracted_name: string;
      store: string;
      page: number | null;
      updated_at: string | null;
      reason: string | null;
    }> = [];
    for (const s of sessions) {
      const internalKey = s.key.startsWith("leaflet_review_state:")
        ? s.key.slice("leaflet_review_state:".length)
        : s.key;

      const pages = s.state.offersByPage && typeof s.state.offersByPage === "object" ? s.state.offersByPage : null;
      if (pages) {
        for (const [pStr, arr] of Object.entries(pages)) {
          const pageNum = Number(pStr);
          const st = (s.state.rowStatusByPage ?? {})[pStr] ?? {};
          const rr = (s.state.rowReasonByPage ?? {})[pStr] ?? {};
          for (let i = 0; i < (arr ?? []).length; i++) {
            const status = (st as any)[i] ?? "pending";
            const migrated = status === "quarantined" ? "quarantine" : status;
            if (migrated !== "quarantine") continue;
            const o = (arr as any[])[i] ?? {};
            const r = (rr as any)[i] ?? null;
            const reason =
              r && typeof r === "object"
                ? [r.kind, r.code, r.detail].filter((x: any) => (x ?? "").toString().trim()).join(":")
                : null;
            const resumeHref = (() => {
              const p = new URLSearchParams("tab=quarantine&filter=quarantine");
              p.set("resume_key", internalKey);
              if (Number.isFinite(pageNum) && pageNum >= 1) p.set("focus_page", String(pageNum));
              p.set("focus_idx", String(i));
              return `/review?${p.toString()}`;
            })();
            items.push({
              sessionKey: internalKey,
              resumeHref,
              extracted_name: (o.extracted_name ?? "—").toString(),
              store: (o.store_id ?? o.source_type ?? "—").toString(),
              page: typeof o.page_no === "number" ? o.page_no : null,
              updated_at: s.state.updated_at ?? null,
              reason,
            });
          }
        }
        continue;
      }
      const legacy = Array.isArray(s.state.offers) ? s.state.offers : [];
      const st = (s.state.rowStatus ?? {}) as any;
      for (let i = 0; i < legacy.length; i++) {
        const status = st[i] ?? "pending";
        const migrated = status === "quarantined" ? "quarantine" : status;
        if (migrated !== "quarantine") continue;
        const o = legacy[i] ?? {};
        const resumeHref = (() => {
          const p = new URLSearchParams("tab=quarantine&filter=quarantine");
          p.set("resume_key", internalKey);
          p.set("focus_idx", String(i));
          return `/review?${p.toString()}`;
        })();
        items.push({
          sessionKey: internalKey,
          resumeHref,
          extracted_name: (o.extracted_name ?? "—").toString(),
          store: (o.store_id ?? o.source_type ?? "—").toString(),
          page: typeof o.page_no === "number" ? o.page_no : null,
          updated_at: s.state.updated_at ?? null,
          reason: null,
        });
      }
    }
    return items;
  }, [sessions]);

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Karanténa
          </h1>
          <p className="mt-2 text-slate-600">
            Lokální režim (bez Supabase): ukazuju karanténu z rozpracovaných kontrol.
          </p>
        </div>
        <Link href={reviewQuarantineHref()} className="text-sm font-semibold text-indigo-700 hover:underline">
          Otevřít review karanténu →
        </Link>
      </div>

      {localItems.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-[0_4px_24px_rgba(15,23,42,0.04)]">
          <p className="text-slate-600">Zatím žádné položky v karanténě.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100">
          <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
            <p className="text-sm font-semibold text-slate-900">
              Položky v karanténě: {localItems.length}
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {localItems.slice(0, 200).map((x, idx) => (
              <div key={idx} className="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{x.extracted_name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {x.store} · str. {x.page ?? "—"} · session {x.sessionKey}
                    {x.updated_at ? ` · ${new Date(x.updated_at).toLocaleString("cs-CZ")}` : ""}
                  </p>
                  {x.reason ? (
                    <p className="mt-1 text-xs text-slate-600">
                      Důvod: <span className="font-semibold text-slate-700">{x.reason}</span>
                    </p>
                  ) : null}
                </div>
                <Link
                  href={x.resumeHref}
                  className="inline-flex items-center justify-center rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 hover:bg-indigo-700"
                >
                  Otevřít →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

