"use client";

import { createClient } from "@/lib/supabase/client";
import { type RetailerId, useLeafletPreview } from "@/components/leaflet/preview-context";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type IntakeReady = {
  ok: true;
  intake_id: string;
  original_name: string | null;
  mime: string;
  upload_bucket: string;
  upload_path: string;
  upload_token: string;
};

type IntakeFail = { ok: false; error?: string };

export function UploadFormStorage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    fileName,
    blobUrl,
    retailer,
    sourceUrl,
    setRetailer,
    setSourceUrl,
    setFromFile,
    clear,
  } = useLeafletPreview();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [method, setMethod] = useState<"ocr" | "vision" | "local">("ocr");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [meta, setMeta] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function applyFile(file?: File) {
    if (!file) return;
    const ok = setFromFile(file);
    if (!ok) {
      setStatus("Vyber PDF nebo obrázek (PNG, JPG, WebP).");
      setError(true);
      return;
    }
    setSelectedFile(file);
    setMeta(`${formatSize(file.size)} · ${file.type === "application/pdf" ? "PDF" : file.type}`);
    setStatus("");
    setError(false);
  }

  async function upload() {
    const file = selectedFile ?? inputRef.current?.files?.[0] ?? null;
    if (!file) {
      setStatus("Soubor není dostupný. Vyber ho znovu.");
      setError(true);
      return;
    }

    setBusy(true);
    setStatus("Připravuji přímý upload do Supabase Storage…");
    setError(false);

    try {
      const prepare = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, mime: file.type, size: file.size }),
      });

      const data = (await prepare.json().catch(() => null)) as IntakeReady | IntakeFail | null;
      if (!prepare.ok || !data || data.ok !== true) {
        throw new Error(data && "error" in data && data.error ? data.error : `Příprava uploadu selhala (HTTP ${prepare.status}).`);
      }

      setStatus("Nahrávám soubor přímo do Supabase Storage…");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(data.upload_bucket)
        .uploadToSignedUrl(data.upload_path, data.upload_token, file, {
          contentType: data.mime,
          upsert: false,
        });

      if (uploadError) throw new Error(uploadError.message);

      const qs = new URLSearchParams({
        intake_id: data.intake_id,
        name: data.original_name ?? file.name ?? "leaflet",
        mime: data.mime,
        extract: method,
      });
      router.push(`/review?${qs.toString()}`);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Upload se nepodařilo dokončit.");
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-slate-200/90 bg-white p-8 shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100 sm:p-10">
      <div className="mb-6 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
        <span className={step === 1 ? "text-slate-900" : ""}>Krok 1</span><span>→</span>
        <span className={step === 2 ? "text-slate-900" : ""}>Krok 2</span><span>→</span>
        <span className={step === 3 ? "text-slate-900" : ""}>Krok 3</span>
      </div>

      <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => applyFile(e.target.files?.[0])} />

      {step === 1 ? (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Krok 1 — Vyber PDF nebo obrázek</p>
            <p className="mt-1 text-sm text-slate-600">Soubor se při spuštění nahraje přímo do Supabase Storage, ne přes Vercel.</p>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            onDragOver={(e: DragEvent) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e: DragEvent) => { e.preventDefault(); setDrag(false); applyFile(e.dataTransfer.files?.[0]); }}
            className={`flex min-h-[192px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed bg-slate-50/50 transition ${drag ? "border-indigo-500 bg-indigo-50/80" : "border-slate-300 hover:border-indigo-400"}`}
          >
            <span className="text-4xl">📄</span>
            <p className="mt-3 text-sm font-semibold text-slate-800">Přetáhni sem PDF nebo obrázek</p>
            <p className="text-xs text-slate-500">nebo klikni pro výběr</p>
            <p className="mt-2 text-sm font-semibold text-indigo-600">{fileName ?? "Žádný soubor"}</p>
            {meta ? <p className="mt-1 text-xs text-slate-400">{meta}</p> : null}
          </div>
          {blobUrl ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <iframe title="Náhled souboru" src={blobUrl} className="h-64 w-full bg-white" />
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Krok 2 — Vyber obchod</p>
            <p className="mt-1 text-sm text-slate-600">Použije se pro parser a metadata.</p>
          </div>
          <select value={retailer} onChange={(e) => setRetailer(e.target.value as RetailerId)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
            <option value="lidl">Lidl</option><option value="kaufland">Kaufland</option><option value="billa">Billa</option><option value="albert">Albert</option><option value="penny">Penny</option><option value="other">jiné</option>
          </select>
          <input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Odkaz na leták (volitelné)" className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" />
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Krok 3 — Způsob zpracování</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {([['ocr','OCR','Lokální OCR (Tesseract).'],['vision','Vision API','Cloud vision.'],['local','Lokální LLM','OCR → Ollama.']] as const).map(([value,title,desc]) => (
              <button key={value} type="button" onClick={() => setMethod(value)} className={method === value ? "rounded-3xl border border-indigo-600 bg-indigo-600 px-5 py-4 text-left text-sm font-semibold text-white" : "rounded-3xl border border-slate-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-900"}>
                {title}<div className={method === value ? "mt-1 text-xs text-white/80" : "mt-1 text-xs text-slate-500"}>{desc}</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {status ? <p className={`mt-5 text-sm ${error ? "text-rose-600" : "text-slate-600"}`}>{status}</p> : null}

      <div className="mt-6 flex gap-3">
        {step > 1 ? <button type="button" disabled={busy} onClick={() => setStep(step === 3 ? 2 : 1)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold">← Zpět</button> : null}
        {step < 3 ? <button type="button" disabled={!selectedFile && step === 1} onClick={() => setStep(step === 1 ? 2 : 3)} className="ml-auto rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">Další →</button> : null}
        {step === 3 ? <button type="button" disabled={busy || !selectedFile} onClick={upload} className="ml-auto flex-1 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Nahrávám…" : "Nahrát a začít zpracování"}</button> : null}
      </div>

      {selectedFile ? <button type="button" disabled={busy} onClick={() => { clear(); setSelectedFile(null); setMeta(""); if (inputRef.current) inputRef.current.value = ""; }} className="mt-4 w-full rounded-2xl border border-rose-200 bg-rose-50 py-3 text-sm font-semibold text-rose-800">Smazat vložený leták</button> : null}
    </div>
  );
}
