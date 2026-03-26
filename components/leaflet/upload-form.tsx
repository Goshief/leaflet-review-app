"use client";

import {
  type RetailerId,
  useLeafletPreview,
} from "@/components/leaflet/preview-context";
import type { ReviewOfferRow } from "@/components/review/offers-table";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    fileName,
    blobUrl,
    kind,
    manualImportText,
    retailer,
    sourceUrl,
    setRetailer,
    setSourceUrl,
    setFromFile,
    startManualImport,
    clear,
  } = useLeafletPreview();
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [drag, setDrag] = useState(false);
  const [meta, setMeta] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<"file" | "excel">("file"); // krok 1: zdroj
  const [method, setMethod] = useState<"ocr" | "vision" | "local" | "manual">("ocr"); // krok 3
  const [excelText, setExcelText] = useState(manualImportText);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyErr, setVerifyErr] = useState<string | null>(null);
  const [verifiedOffers, setVerifiedOffers] = useState<ReviewOfferRow[] | null>(null);

  useEffect(() => {
    // Když je zdroj excel, jediný validní způsob je ruční import.
    setMethod(mode === "excel" ? "manual" : "ocr");
    setStep(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Prefill z "Duplikovat" na stránce Letáky (/batches).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("leaflet_upload_prefill");
      if (!raw) return;
      sessionStorage.removeItem("leaflet_upload_prefill");
      const p = JSON.parse(raw) as { retailer?: string; sourceUrl?: string };
      if (p?.retailer) setRetailer(p.retailer as RetailerId);
      if (typeof p?.sourceUrl === "string") setSourceUrl(p.sourceUrl);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFile = useCallback(
    (file: File | undefined) => {
      if (!file) {
        setStatus("Soubor se nepodařilo načíst.");
        setError(true);
        return;
      }
      setError(false);
      setStatus("");
      const ok = setFromFile(file);
      if (!ok) {
        setStatus("Vyber PDF nebo obrázek (PNG, JPG, WebP).");
        setError(true);
        return;
      }
      setMeta(
        `${formatSize(file.size)} · ${file.type === "application/pdf" ? "PDF" : file.type}`
      );
    },
    [setFromFile]
  );

  const metaLine = fileName ? meta : "";

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDrag(false);
      const f = e.dataTransfer.files?.[0];
      applyFile(f);
    },
    [applyFile]
  );

  const field =
    "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20";

  const verifyManualImport = useCallback(async () => {
    const text = excelText.trim();
    if (!text) {
      setVerifyErr("Vlož semicolon CSV (hlavička + řádky) nebo JSON pole.");
      setVerifiedOffers(null);
      return;
    }
    setVerifyBusy(true);
    setVerifyErr(null);
    setVerifiedOffers(null);
    try {
      const res = await fetch("/api/import-offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as
        | { ok: true; offers: ReviewOfferRow[]; model?: string }
        | { ok?: false; error?: string; validation_errors?: string[] };
      if (!res.ok || !(data as any)?.ok) {
        const err = (data as any)?.error || `HTTP ${res.status}`;
        const v = Array.isArray((data as any)?.validation_errors) ? (data as any).validation_errors : [];
        setVerifyErr(v.length ? `${err}: ${v.slice(0, 3).join("; ")}` : err);
        setVerifiedOffers(null);
        return;
      }
      const offers = ((data as any).offers ?? []) as ReviewOfferRow[];
      setVerifiedOffers(offers);
    } catch {
      setVerifyErr("Síťová chyba nebo neplatná odpověď serveru.");
      setVerifiedOffers(null);
    } finally {
      setVerifyBusy(false);
    }
  }, [excelText]);

  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-slate-200/90 bg-white p-8 shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100 sm:p-10">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span className={step === 1 ? "text-slate-900" : ""}>Krok 1</span>
            <span>→</span>
            <span className={step === 2 ? "text-slate-900" : ""}>Krok 2</span>
            <span>→</span>
            <span className={step === 3 ? "text-slate-900" : ""}>Krok 3</span>
          </div>
          <div className="flex gap-2">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                ← Zpět
              </button>
            ) : null}
            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
                className="rounded-2xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Další →
              </button>
            ) : null}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            applyFile(f);
          }}
        />

        {step === 1 ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Krok 1 — Vyber zdroj</p>
              <p className="mt-1 text-sm text-slate-600">
                Nejdřív řekni, odkud data bereme. Další volby uvidíš až v dalších krocích.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode("file")}
                className={
                  mode === "file"
                    ? "rounded-3xl border border-slate-900 bg-slate-900 px-5 py-4 text-left text-sm font-semibold text-white shadow-sm"
                    : "rounded-3xl border border-slate-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
                }
              >
                PDF / obrázek letáku
                <div className={mode === "file" ? "mt-1 text-xs text-white/80" : "mt-1 text-xs text-slate-500"}>
                  Nahraješ soubor a pak zvolíš OCR / Vision / Lokální LLM.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode("excel")}
                className={
                  mode === "excel"
                    ? "rounded-3xl border border-indigo-600 bg-indigo-600 px-5 py-4 text-left text-sm font-semibold text-white shadow-sm"
                    : "rounded-3xl border border-slate-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
                }
              >
                Excel / CSV / ChatGPT výstup
                <div className={mode === "excel" ? "mt-1 text-xs text-white/80" : "mt-1 text-xs text-slate-500"}>
                  Ruční import bez PDF náhledu.
                </div>
              </button>
            </div>

            {mode === "file" ? (
              <div
                role="button"
                tabIndex={0}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    inputRef.current?.click();
                  }
                }}
                onClick={() => inputRef.current?.click()}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDrag(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDrag(false);
                }}
                onDrop={onDrop}
                className={`flex min-h-[192px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed bg-slate-50/50 transition ${
                  drag
                    ? "border-indigo-500 bg-indigo-50/80 shadow-inner"
                    : "border-slate-300 hover:border-indigo-400 hover:bg-white"
                }`}
              >
                <span className="text-4xl opacity-90">📄</span>
                <p className="mt-3 text-center text-sm font-semibold text-slate-800">
                  Přetáhni sem PDF nebo obrázek
                </p>
                <p className="text-xs text-slate-500">nebo klikni pro výběr</p>
                <p className="mt-2 min-h-[1.25rem] text-sm font-semibold text-indigo-600">
                  {fileName ?? "Žádný soubor"}
                </p>
                {metaLine ? <p className="mt-1 text-xs text-slate-400">{metaLine}</p> : null}
              </div>
            ) : (
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                <p className="text-sm font-semibold text-slate-800">Vlož výstup z Excelu / ChatGPT</p>
                <p className="mt-1 text-sm text-slate-600">
                  Podporujeme semicolon CSV (hlavička + řádky) nebo JSON pole.
                </p>
                <textarea
                  value={excelText}
                  onChange={(e) => setExcelText(e.target.value)}
                  placeholder="store_id;source_type;page_no;...;raw_text_block"
                  className="mt-3 h-40 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-800 shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={verifyManualImport}
                    disabled={verifyBusy || !excelText.trim()}
                    className="rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-900 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {verifyBusy ? "Ověřuji…" : "Ověřit import"}
                  </button>
                  {verifiedOffers ? (
                    <span className="text-sm font-semibold text-emerald-700">
                      Načteno: {verifiedOffers.length}
                    </span>
                  ) : null}
                  {verifyErr ? <span className="text-sm font-semibold text-rose-700">{verifyErr}</span> : null}
                </div>
                {verifiedOffers && verifiedOffers.length ? (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Náhled (první 4)
                    </p>
                    <div className="mt-2 space-y-2">
                      {verifiedOffers.slice(0, 4).map((o, i) => (
                        <div key={i} className="flex items-start justify-between gap-3 text-sm">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-slate-900">
                              {(o.extracted_name ?? "").toString() || "—"}
                            </p>
                            <p className="text-xs text-slate-500">
                              strana {typeof o.page_no === "number" ? o.page_no : "—"} ·{" "}
                              {(o.store_id ?? "").toString() || retailer}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-semibold text-slate-900">
                              {o.price_total != null ? Number(o.price_total).toFixed(2) : "—"}{" "}
                              {(o.currency ?? "CZK").toString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">Krok 2 — Vyber obchod</p>
              <p className="mt-1 text-sm text-slate-600">Použije se pro parser/normalizaci a metadata.</p>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Obchod</label>
              <select
                value={retailer}
                onChange={(e) => setRetailer(e.target.value as RetailerId)}
                className={field}
              >
                <option value="lidl">Lidl</option>
                <option value="kaufland">Kaufland</option>
                <option value="billa">Billa</option>
                <option value="albert">Albert</option>
                <option value="penny">Penny</option>
                <option value="other">jiné</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Odkaz na leták (volitelné)
              </label>
              <input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://…"
                className={field}
              />
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Krok 3 — Vyber způsob zpracování</p>
              <p className="mt-1 text-sm text-slate-600">
                Vybereš jen jednu cestu. V kontrole to půjde kdykoliv změnit.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={mode === "excel"}
                onClick={() => setMethod("ocr")}
                className={
                  method === "ocr"
                    ? "rounded-3xl border border-indigo-600 bg-indigo-600 px-5 py-4 text-left text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                    : "rounded-3xl border border-slate-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                }
              >
                OCR
                <div className={method === "ocr" ? "mt-1 text-xs text-white/80" : "mt-1 text-xs text-slate-500"}>
                  Lokální OCR (Tesseract). Bez API klíče.
                </div>
              </button>
              <button
                type="button"
                disabled={mode === "excel"}
                onClick={() => setMethod("vision")}
                className={
                  method === "vision"
                    ? "rounded-3xl border border-violet-600 bg-violet-600 px-5 py-4 text-left text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                    : "rounded-3xl border border-slate-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                }
              >
                Vision API
                <div className={method === "vision" ? "mt-1 text-xs text-white/80" : "mt-1 text-xs text-slate-500"}>
                  Cloud vision (vyžaduje klíče v `.env.local`).
                </div>
              </button>
              <button
                type="button"
                disabled={mode === "excel"}
                onClick={() => setMethod("local")}
                className={
                  method === "local"
                    ? "rounded-3xl border border-emerald-600 bg-emerald-600 px-5 py-4 text-left text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                    : "rounded-3xl border border-slate-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                }
              >
                Lokální LLM
                <div className={method === "local" ? "mt-1 text-xs text-white/80" : "mt-1 text-xs text-slate-500"}>
                  OCR bloky → Ollama normalizace.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMethod("manual")}
                className={
                  method === "manual"
                    ? "rounded-3xl border border-slate-900 bg-slate-900 px-5 py-4 text-left text-sm font-semibold text-white shadow-sm"
                    : "rounded-3xl border border-slate-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
                }
              >
                Ruční import
                <div className={method === "manual" ? "mt-1 text-xs text-white/80" : "mt-1 text-xs text-slate-500"}>
                  Vhodné pro Excel/CSV/ChatGPT.
                </div>
              </button>
            </div>
            {mode === "excel" ? (
              <p className="text-xs text-slate-500">
                Pro Excel/CSV je dostupný jen <strong>Ruční import</strong>.
              </p>
            ) : null}
          </div>
        ) : null}

        {status ? (
          <p
            className={`text-sm ${error ? "text-rose-600" : "text-slate-600"}`}
            aria-live="polite"
          >
            {status}
          </p>
        ) : null}

        {blobUrl && kind ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
            <p className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Náhled souboru
            </p>
            <div className="relative h-64 w-full bg-white">
              {kind === "pdf" ? (
                <iframe
                  title="Náhled PDF"
                  src={blobUrl}
                  className="h-full w-full"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={blobUrl}
                  alt="Náhled"
                  className="mx-auto max-h-64 w-full object-contain"
                />
              )}
            </div>
          </div>
        ) : null}

        {mode === "file" && blobUrl ? (
          <button
            type="button"
            disabled={uploadBusy}
            onClick={() => {
              clear();
              setMeta("");
              setStatus("");
              setError(false);
              const input = inputRef.current;
              if (input) input.value = "";
            }}
            className="w-full rounded-2xl border border-rose-200 bg-rose-50 py-3 text-sm font-semibold text-rose-800 shadow-sm transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Smazat vložený leták
          </button>
        ) : null}

        <button
          type="button"
          disabled={
            step !== 3 ||
            uploadBusy ||
            (mode === "file"
              ? !blobUrl || method === "manual"
              : !excelText.trim() || method !== "manual")
          }
          onClick={async () => {
            if (mode === "excel") {
              // Persist session (aby produkty nezmizely po refreshi).
              const session_id =
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : String(Date.now());
              try {
                localStorage.setItem(
                  `leaflet_manual_session:${session_id}`,
                  JSON.stringify({
                    manualText: excelText,
                    retailer,
                    sourceUrl,
                    created_at: new Date().toISOString(),
                  })
                );
              } catch {
                // ignore (localStorage může být blokované)
              }
              startManualImport(excelText);
              router.push(
                `/review?mode=manual&session_id=${encodeURIComponent(session_id)}`
              );
              return;
            }
            if (!blobUrl || !kind) return;
            setUploadBusy(true);
            setStatus("");
            setError(false);
            try {
              // Persistuj soubor na serveru, aby nezmizel po refreshi stránky.
              const input = inputRef.current;
              const f = input?.files?.[0];
              if (!f) {
                setStatus("Soubor není dostupný (zkus vybrat znovu).");
                setError(true);
                return;
              }
              const fd = new FormData();
              fd.append("file", f);
              const res = await fetch("/api/intake", { method: "POST", body: fd });
              const data = (await res.json()) as
                | { ok: true; intake_id: string; original_name: string | null; mime: string }
                | { ok: false; error: string };
              if (!res.ok || !data.ok) {
                setStatus(("error" in data && data.error) || `HTTP ${res.status}`);
                setError(true);
                return;
              }
              const qs = new URLSearchParams({
                intake_id: data.intake_id,
                name: data.original_name ?? f.name ?? "leaflet",
                mime: data.mime,
                extract: method,
              });
              router.push(`/review?${qs.toString()}`);
            } catch {
              setStatus("Upload selhal (síťová chyba).");
              setError(true);
            } finally {
              setUploadBusy(false);
            }
          }}
          className="w-full rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 py-4 text-sm font-semibold text-white shadow-xl shadow-indigo-500/25 transition hover:from-indigo-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploadBusy
            ? "Ukládám…"
            : mode === "file"
              ? "Nahrát a začít zpracování"
              : "Otevřít kontrolu"}
        </button>
      </div>
    </div>
  );
}
