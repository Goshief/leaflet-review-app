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

function messageOf(value: unknown, fallback: string) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.error === "string") return candidate.error;
    if (typeof candidate.message === "string") return candidate.message;
    try { return JSON.stringify(value); } catch { return fallback; }
  }
  return fallback;
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

type VerifiedOffer = {
  extracted_name?: string | null;
  price_total?: number | null;
  price_standard?: number | null;
  price_with_loyalty_card?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
  confidence?: number | null;
  status: "approved" | "quarantine";
  verification_reason?: string | null;
  [key: string]: unknown;
};

type AiReview = {
  page: number;
  page_count: number;
  approved_count: number;
  quarantine_count: number;
  verified_offers: VerifiedOffer[];
};

type Uploaded = { bucket: string; path: string };

export function UploadFormStorage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const { fileName, blobUrl, retailer, sourceUrl, setRetailer, setSourceUrl, setFromFile, clear } = useLeafletPreview();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [method, setMethod] = useState<"ai" | "ocr" | "vision" | "local">("ai");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [meta, setMeta] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [review, setReview] = useState<AiReview | null>(null);
  const [completed, setCompleted] = useState(false);

  function applyFile(file?: File) {
    if (!file) return;
    const ok = setFromFile(file);
    if (!ok) {
      setStatus("Vyber PDF nebo obrázek (PNG, JPG, WebP).");
      setError(true);
      return;
    }
    setSelectedFile(file);
    setUploaded(null);
    setReview(null);
    setCompleted(false);
    setMeta(`${formatSize(file.size)} · ${file.type === "application/pdf" ? "PDF" : file.type}`);
    setStatus("");
    setError(false);
  }

  async function processAiPage(target: Uploaded, page: number) {
    setStatus(`AI čte a podruhé kontroluje stranu ${page}…`);
    const response = await fetch("/api/leaflet-ai/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: target.bucket,
        path: target.path,
        retailer,
        source_url: sourceUrl || null,
        page,
        dry_run: true,
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(messageOf(data, `AI kontrola selhala (HTTP ${response.status}).`));
    setReview({
      page: data.page,
      page_count: data.page_count,
      approved_count: data.approved_count ?? 0,
      quarantine_count: data.quarantine_count ?? 0,
      verified_offers: data.verified_offers ?? [],
    });
    setStatus(`Strana ${data.page}/${data.page_count} je připravená ke schválení.`);
  }

  async function approvePage() {
    if (!uploaded || !review) return;
    setBusy(true);
    setError(false);
    try {
      setStatus(`Zapisuji schválenou stranu ${review.page}…`);
      const response = await fetch("/api/leaflet-ai/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucket: uploaded.bucket,
          path: uploaded.path,
          page: review.page,
          verified_offers: review.verified_offers,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(messageOf(data, `Schválení selhalo (HTTP ${response.status}).`));
      if (data.completed) {
        setReview(null);
        setCompleted(true);
        setStatus("Leták je kompletně zpracovaný a zapsaný.");
      } else {
        const nextPage = Number(data.next_page || review.page + 1);
        setReview(null);
        await processAiPage(uploaded, nextPage);
      }
    } catch (cause) {
      setStatus(messageOf(cause, "Schválení stránky selhalo."));
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    const file = selectedFile ?? inputRef.current?.files?.[0] ?? null;
    if (!file) {
      setStatus("Soubor není dostupný. Vyber ho znovu.");
      setError(true);
      return;
    }
    if (method === "ai" && file.type !== "application/pdf") {
      setStatus("AI kontrola stránku po stránce přijímá celé PDF. Pro obrázek použij Vision API.");
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
        body: JSON.stringify({ name: file.name, mime: file.type, size: file.size, retailer }),
      });

      const data = (await prepare.json().catch(() => null)) as IntakeReady | IntakeFail | null;
      if (!prepare.ok || !data || data.ok !== true) {
        throw new Error(data && "error" in data && data.error ? data.error : `Příprava uploadu selhala (HTTP ${prepare.status}).`);
      }

      setStatus("Nahrávám soubor přímo do Supabase Storage…");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage.from(data.upload_bucket).uploadToSignedUrl(data.upload_path, data.upload_token, file, {
        contentType: data.mime,
        upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);

      if (method === "ai") {
        const target = { bucket: data.upload_bucket, path: data.upload_path };
        setUploaded(target);
        await processAiPage(target, 1);
        return;
      }

      const qs = new URLSearchParams({
        intake_id: data.intake_id,
        name: data.original_name ?? file.name ?? "leaflet",
        mime: data.mime,
        extract: method,
      });
      router.push(`/review?${qs.toString()}`);
    } catch (cause) {
      setStatus(messageOf(cause, "Upload se nepodařilo dokončit."));
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl rounded-3xl border border-slate-200/90 bg-white p-8 shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100 sm:p-10">
      <div className="mb-6 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
        <span className={step === 1 ? "text-slate-900" : ""}>Krok 1</span><span>→</span>
        <span className={step === 2 ? "text-slate-900" : ""}>Krok 2</span><span>→</span>
        <span className={step === 3 ? "text-slate-900" : ""}>Krok 3</span>
      </div>

      <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => applyFile(e.target.files?.[0])} />

      {step === 1 ? (
        <div className="space-y-4">
          <div><p className="text-sm font-semibold text-slate-900">Krok 1 — Vyber PDF nebo obrázek</p><p className="mt-1 text-sm text-slate-600">Soubor se nahraje přímo do Supabase Storage.</p></div>
          <div role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }} onDragOver={(e: DragEvent) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e: DragEvent) => { e.preventDefault(); setDrag(false); applyFile(e.dataTransfer.files?.[0]); }} className={`flex min-h-[192px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed bg-slate-50/50 transition ${drag ? "border-indigo-500 bg-indigo-50/80" : "border-slate-300 hover:border-indigo-400"}`}>
            <span className="text-4xl">📄</span><p className="mt-3 text-sm font-semibold text-slate-800">Přetáhni sem PDF nebo obrázek</p><p className="text-xs text-slate-500">nebo klikni pro výběr</p><p className="mt-2 text-sm font-semibold text-indigo-600">{fileName ?? "Žádný soubor"}</p>{meta ? <p className="mt-1 text-xs text-slate-400">{meta}</p> : null}
          </div>
          {blobUrl ? <div className="overflow-hidden rounded-2xl border border-slate-200"><iframe title="Náhled souboru" src={blobUrl} className="h-64 w-full bg-white" /></div> : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <div><p className="text-sm font-semibold text-slate-900">Krok 2 — Vyber obchod</p><p className="mt-1 text-sm text-slate-600">Podle obchodu se soubor uloží do správné složky a označí nabídky.</p></div>
          <select value={retailer} onChange={(e) => setRetailer(e.target.value as RetailerId)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
            <option value="lidl">Lidl</option><option value="kaufland">Kaufland</option><option value="billa">Billa</option><option value="albert">Albert</option><option value="penny">Penny</option><option value="other">jiné</option>
          </select>
          <input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Odkaz na leták (volitelné)" className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" />
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <div><p className="text-sm font-semibold text-slate-900">Krok 3 — Způsob zpracování</p><p className="mt-1 text-sm text-slate-600">Pro celý PDF leták použij první volbu. AI zpracuje vždy jednu stránku, udělá druhou kontrolu a čeká na tvoje schválení.</p></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {([['ai','AI kontrola letáku','PDF → strana 1 → dvojitá AI kontrola → schválení → další strana.'],['ocr','OCR','Servisní režim: lokální OCR (Tesseract).'],['vision','Vision API','Servisní režim pro obrázek / jednorázovou kontrolu.'],['local','Lokální LLM','Servisní režim: OCR → Ollama.']] as const).map(([value,title,desc]) => (
              <button key={value} type="button" onClick={() => setMethod(value)} className={method === value ? "rounded-3xl border border-indigo-600 bg-indigo-600 px-5 py-4 text-left text-sm font-semibold text-white" : "rounded-3xl border border-slate-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-900"}>{title}<div className={method === value ? "mt-1 text-xs text-white/80" : "mt-1 text-xs text-slate-500"}>{desc}</div></button>
            ))}
          </div>
        </div>
      ) : null}

      {status ? <p className={`mt-5 rounded-xl p-3 text-sm ${error ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-700"}`}>{status}</p> : null}

      {review ? (
        <div className="mt-6 rounded-2xl border-2 border-indigo-200 bg-indigo-50/40 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="text-lg font-bold text-slate-900">AI kontrola · strana {review.page}/{review.page_count}</h3><p className="text-sm text-slate-600">Bezpečné: {review.approved_count} · karanténa: {review.quarantine_count}. Zatím nic není zapsané.</p></div>
            <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => setReview(null)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">Zahodit výsledek</button><button type="button" disabled={busy} onClick={() => void approvePage()} className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Schválit stranu a pokračovat</button></div>
          </div>
          <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead><tr className="border-b border-slate-200 text-slate-500"><th className="p-2">Stav</th><th className="p-2">Produkt</th><th className="p-2">Cena</th><th className="p-2">Původní</th><th className="p-2">Platnost</th><th className="p-2">Jistota</th><th className="p-2">Druhá kontrola</th></tr></thead><tbody>{review.verified_offers.map((offer, index) => <tr key={index} className="border-b border-slate-100 align-top"><td className="p-2 font-bold">{offer.status}</td><td className="p-2">{offer.extracted_name ?? "—"}</td><td className="p-2">{offer.price_total ?? "—"}</td><td className="p-2">{offer.price_standard ?? "—"}</td><td className="p-2">{offer.valid_from ?? "—"} → {offer.valid_to ?? "—"}</td><td className="p-2">{offer.confidence == null ? "—" : `${Math.round(offer.confidence * 100)} %`}</td><td className="p-2">{offer.verification_reason ?? "OK"}</td></tr>)}</tbody></table></div>
        </div>
      ) : null}

      {completed ? <div className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800">Hotovo: všechny stránky byly schválené a zapsané.</div> : null}

      <div className="mt-6 flex gap-3">
        {step > 1 && !review ? <button type="button" disabled={busy} onClick={() => setStep(step === 3 ? 2 : 1)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold">← Zpět</button> : null}
        {step < 3 ? <button type="button" disabled={!selectedFile && step === 1} onClick={() => setStep(step === 1 ? 2 : 3)} className="ml-auto rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">Další →</button> : null}
        {step === 3 && !uploaded ? <button type="button" disabled={busy || !selectedFile} onClick={() => void upload()} className="ml-auto flex-1 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Pracuji…" : method === "ai" ? "Nahrát a zkontrolovat stranu 1" : "Nahrát a začít zpracování"}</button> : null}
      </div>

      {selectedFile ? <button type="button" disabled={busy} onClick={() => { clear(); setSelectedFile(null); setUploaded(null); setReview(null); setCompleted(false); setMeta(""); setStatus(""); if (inputRef.current) inputRef.current.value = ""; }} className="mt-4 w-full rounded-2xl border border-rose-200 bg-rose-50 py-3 text-sm font-semibold text-rose-800">Smazat vložený leták</button> : null}
    </div>
  );
}
