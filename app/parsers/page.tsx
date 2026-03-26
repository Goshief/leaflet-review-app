"use client";

import { useCallback, useMemo, useState } from "react";
import { useToasts } from "@/components/ui/toasts";

type StoreId = string;

function StoreCard({
  storeId,
  title,
  subtitle,
}: {
  storeId: StoreId;
  title: string;
  subtitle: string;
}) {
  const toast = useToasts();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [adminName, setAdminName] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [configDefaultExtract, setConfigDefaultExtract] = useState<"ocr" | "vision" | "local">("ocr");
  const [configEnabled, setConfigEnabled] = useState(true);

  const [editTitle, setEditTitle] = useState(title);
  const [editSubtitle, setEditSubtitle] = useState(subtitle);
  const [editPrompt, setEditPrompt] = useState("");
  const canSave = useMemo(
    () => !!editTitle.trim() && !!editPrompt.trim(),
    [editTitle, editPrompt]
  );

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/parser-prompt?store_id=${encodeURIComponent(storeId)}`);
      const data = (await res.json()) as
        | {
            ok: true;
            store_id: string;
            prompt: string;
            title?: string;
            subtitle?: string;
            updated_at?: string | null;
            updated_by?: string | null;
            version?: number | null;
            config?: { default_extract?: "ocr" | "vision" | "local"; enabled?: boolean; notes?: string } | null;
          }
        | { error?: string };
      if (!res.ok || !("ok" in data)) {
        setErr(("error" in data && data.error) || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      setEditTitle((data.title ?? title).toString());
      setEditSubtitle((data.subtitle ?? subtitle).toString());
      setEditPrompt(data.prompt ?? "");
      setUpdatedAt((data.updated_at ?? null) as any);
      setUpdatedBy((data.updated_by ?? null) as any);
      setVersion(typeof (data as any).version === "number" ? (data as any).version : null);
      setConfigDefaultExtract(((data as any).config?.default_extract ?? "ocr") as any);
      setConfigEnabled(((data as any).config?.enabled ?? true) as any);
      setLoaded(true);
      setBusy(false);
    } catch {
      setErr("Síťová chyba.");
      setBusy(false);
    }
  }, [storeId, title, subtitle]);

  const copy = useCallback(async () => {
    setErr(null);
    setCopied(false);
    try {
      const p = editPrompt ?? "";
      if (!p.trim()) {
        setErr("Prompt je prázdný.");
        return;
      }
      await navigator.clipboard.writeText(p);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setErr("Clipboard není dostupný.");
    }
  }, [editPrompt]);

  const save = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/parser-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: storeId,
          title: editTitle,
          subtitle: editSubtitle,
          prompt: editPrompt,
          updated_by: adminName.trim() || null,
          config: { default_extract: configDefaultExtract, enabled: configEnabled },
        }),
      });
      const data = (await res.json()) as { ok: true } | { ok: false; error?: string };
      if (!res.ok || !("ok" in data) || data.ok !== true) {
        setErr(("error" in data && data.error) || `HTTP ${res.status}`);
        setBusy(false);
        toast.error("Uložení promptu selhalo");
        return;
      }
      setBusy(false);
      toast.success("Parser prompt uložen", `${storeId}`);
    } catch {
      setErr("Uložení selhalo (síťová chyba).");
      setBusy(false);
      toast.error("Uložení promptu selhalo", "Síťová chyba.");
    }
  }, [storeId, editTitle, editSubtitle, editPrompt, adminName, configDefaultExtract, configEnabled, toast]);

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
      <div className="border-b border-slate-200 bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="mt-0.5 text-xs text-white/80">{subtitle}</p>
          </div>
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white/90 ring-1 ring-white/20">
            store_id: {storeId}
          </span>
        </div>
      </div>
      <div className="bg-slate-50/60 p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-900 px-2.5 py-1 font-semibold text-white">
            Pokročilé (admin)
          </span>
          <span className="rounded-full bg-white px-2.5 py-1 text-slate-700 ring-1 ring-slate-200">
            Verze: <strong>{version ?? "—"}</strong>
          </span>
          <span className="rounded-full bg-white px-2.5 py-1 text-slate-700 ring-1 ring-slate-200">
            Poslední změna: <strong>{updatedAt ? new Date(updatedAt).toLocaleString("cs-CZ") : "—"}</strong>
          </span>
          <span className="rounded-full bg-white px-2.5 py-1 text-slate-700 ring-1 ring-slate-200">
            Upravil: <strong>{updatedBy ?? "—"}</strong>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? "Načítám…" : loaded ? "Znovu načíst" : "Načíst prompt"}
          </button>
          <button
            type="button"
            onClick={copy}
            disabled={busy || !editPrompt.trim()}
            className="rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/15 transition hover:from-slate-800 hover:to-indigo-800 disabled:opacity-50"
          >
            {copied ? "Zkopírováno" : "Zkopírovat prompt"}
          </button>
          {editPrompt ? (
            <span className="text-xs text-slate-500">
              {editPrompt.length.toLocaleString("cs")} znaků
            </span>
          ) : null}
        </div>
        {err ? (
          <p className="mt-3 text-sm text-rose-700">{err}</p>
        ) : null}

        <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Admin odemknutí</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              placeholder="Kdo upravuje (např. Klára)"
              className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
            />
            <button
              type="button"
              onClick={() => setUnlocked(true)}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Odemknout editaci
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Bez autentizace: slouží jako “admin only” pojistka proti omylu.
          </p>
        </div>

        <div className="mt-4 grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Název
              </label>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                disabled={!unlocked}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Popis
              </label>
              <input
                value={editSubtitle}
                onChange={(e) => setEditSubtitle(e.target.value)}
                disabled={!unlocked}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Default zpracování
              </label>
              <select
                value={configDefaultExtract}
                onChange={(e) => setConfigDefaultExtract(e.target.value as any)}
                disabled={!unlocked}
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
              >
                <option value="ocr">OCR</option>
                <option value="vision">Vision API</option>
                <option value="local">Lokální LLM</option>
              </select>
            </div>
            <label className="mt-6 inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={configEnabled}
                onChange={(e) => setConfigEnabled(e.target.checked)}
                disabled={!unlocked}
                className="rounded border-slate-300 text-indigo-600"
              />
              Parser aktivní
            </label>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Prompt
            </label>
            <textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              disabled={!unlocked}
              placeholder="Vlož prompt…"
              className="mt-1 h-48 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-800 shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy || !canSave || !unlocked}
              className="rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-700 disabled:opacity-50"
            >
              Uložit prompt
            </button>
            <TestParser storeId={storeId} disabled={busy} />
            <span className="text-xs text-slate-500">
              Ukládá se lokálně do `data/parser-prompts.json`
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TestParser({ storeId, disabled }: { storeId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<any[] | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch("/api/parser-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: storeId, text }),
      });
      const data = (await res.json()) as any;
      if (!res.ok || !data.ok) {
        setErr(data.error || `HTTP ${res.status}`);
        return;
      }
      setOk(data.offers ?? []);
    } catch {
      setErr("Síťová chyba.");
    } finally {
      setBusy(false);
    }
  }, [storeId, text]);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
      >
        Test parseru
      </button>
      {open ? (
        <div className="w-full rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <p className="text-sm font-semibold text-slate-900">Test (validace výstupu)</p>
          <p className="mt-1 text-sm text-slate-600">
            Vlož JSON výstup z modelu a ověř, že odpovídá schématu.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='[{"store_id":"lidl","page_no":1,"extracted_name":"…","price_total":12.9,"currency":"CZK"}]'
            className="mt-3 h-40 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-800 shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy || !text.trim()}
              className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "Testuji…" : "Spustit test"}
            </button>
            {err ? <span className="text-sm font-medium text-rose-700">{err}</span> : null}
            {ok ? <span className="text-sm font-medium text-emerald-700">OK ({ok.length})</span> : null}
          </div>
          {ok ? (
            <details className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm">
              <summary className="cursor-pointer font-semibold text-slate-700">Náhled JSON výstupu</summary>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-600">
                {JSON.stringify(ok.slice(0, 50), null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export default function ParsersPage() {
  const toast = useToasts();
  const [newStoreId, setNewStoreId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newSubtitle, setNewSubtitle] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newBusy, setNewBusy] = useState(false);
  const [newErr, setNewErr] = useState<string | null>(null);
  const [newOk, setNewOk] = useState<string | null>(null);

  const addNew = useCallback(async () => {
    setNewBusy(true);
    setNewErr(null);
    setNewOk(null);
    try {
      const res = await fetch("/api/parser-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: newStoreId,
          title: newTitle,
          subtitle: newSubtitle,
          prompt: newPrompt,
        }),
      });
      const data = (await res.json()) as
        | { ok: true; prompt: { store_id: string } }
        | { ok: false; error?: string };
      if (!res.ok || !("ok" in data) || data.ok !== true) {
        setNewErr(("error" in data && data.error) || `HTTP ${res.status}`);
        setNewBusy(false);
        toast.error("Uložení promptu selhalo");
        return;
      }
      setNewOk(`Přidáno: ${data.prompt.store_id}`);
      setNewBusy(false);
      toast.success("Parser prompt uložen", `${data.prompt.store_id}`);
    } catch {
      setNewErr("Uložení selhalo (síťová chyba).");
      setNewBusy(false);
      toast.error("Uložení promptu selhalo", "Síťová chyba.");
    }
  }, [newStoreId, newTitle, newSubtitle, newPrompt, toast]);

  return (
    <main className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Parsery{" "}
          <span className="ml-2 rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">
            Pokročilé
          </span>
        </h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Odtud si jedním klikem zkopíruješ parser prompt pro každý obchod a vložíš
          ho do ChatGPT.
        </p>
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
        <div className="border-b border-slate-200 bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-900 px-6 py-5">
          <h2 className="text-lg font-semibold text-white">Přidat nový prompt</h2>
          <p className="mt-1 text-sm text-white/80">
            Vyplň náležitosti a vlož prompt. Uloží se do lokálního úložiště a hned
            půjde kopírovat.
          </p>
        </div>
        <div className="bg-slate-50/60 p-6">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                store_id
              </label>
              <input
                value={newStoreId}
                onChange={(e) => setNewStoreId(e.target.value)}
                placeholder="např. kaufland"
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Název
              </label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Kaufland CZ — striktní staging parser"
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Popis
              </label>
              <input
                value={newSubtitle}
                onChange={(e) => setNewSubtitle(e.target.value)}
                placeholder="Jedna stránka → JSON schéma (bez domýšlení)."
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Prompt
              </label>
              <textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder="Vlož celý prompt…"
                className="mt-1 h-56 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-800 shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={addNew}
              disabled={newBusy}
              className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50"
            >
              {newBusy ? "Ukládám…" : "Přidat prompt"}
            </button>
            {newOk ? (
              <span className="text-sm font-medium text-emerald-700">{newOk}</span>
            ) : null}
            {newErr ? (
              <span className="text-sm font-medium text-rose-700">{newErr}</span>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <StoreCard
          storeId="lidl"
          title="Lidl CZ — striktní staging parser"
          subtitle="Produkty z jedné stránky → JSON schéma (bez domýšlení)."
        />
        <StoreCard
          storeId="kaufland"
          title="Kaufland"
          subtitle="Stejný přístup — můžeš prompt vložit a upravit přímo tady."
        />
        <StoreCard
          storeId="albert"
          title="Albert"
          subtitle="Stejný přístup — můžeš prompt vložit a upravit přímo tady."
        />
      </div>
    </main>
  );
}

